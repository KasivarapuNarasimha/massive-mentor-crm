/**
 * WhatsApp caption templates, AI improve/translate, signatures.
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { resolveActorRole } from "./tenant-scope.service.js";
import { getAIService } from "./ai.service.js";
import { renderTemplate } from "./template-vars.service.js";

const ADMIN_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "super_admin",
]);

const CATEGORIES = [
  "Sales",
  "Support",
  "Marketing",
  "Follow-up",
  "Payment",
  "General",
] as const;

const DEFAULT_TEMPLATES: Array<{
  name: string;
  category: string;
  body: string;
}> = [
  {
    name: "Welcome Message",
    category: "Sales",
    body: `Hello {{CustomerName}},

Welcome to {{BusinessName}}! We're delighted to connect with you.

Please find our materials attached. Feel free to reach out anytime.

Regards,
{{SalesExecutive}}`,
  },
  {
    name: "CRM Introduction",
    category: "Sales",
    body: `Hello {{CustomerName}},

Thank you for your interest in our CRM solution.

Please find our introduction materials attached. I'd be happy to schedule a short demo at your convenience.

Regards,
{{SalesExecutive}}`,
  },
  {
    name: "Company Profile",
    category: "Marketing",
    body: `Hello {{CustomerName}},

Please find our company profile attached for your reference.

Looking forward to exploring how we can support {{Company}}.

Regards,
{{SalesExecutive}}`,
  },
  {
    name: "Pricing Details",
    category: "Sales",
    body: `Hello {{CustomerName}},

As discussed, please find our pricing details attached.

Happy to walk you through the options and answer any questions.

Regards,
{{SalesExecutive}}`,
  },
  {
    name: "Proposal Follow-up",
    category: "Follow-up",
    body: `Hello {{CustomerName}},

Just following up on the proposal we shared earlier.

Please let me know if you need any clarifications or would like to discuss next steps.

Regards,
{{SalesExecutive}}`,
  },
  {
    name: "Payment Reminder",
    category: "Payment",
    body: `Hello {{CustomerName}},

This is a friendly reminder regarding the pending payment.

Please find the details attached. Do reach out if you need any support.

Regards,
{{SalesExecutive}}`,
  },
  {
    name: "Festival Wishes",
    category: "General",
    body: `Hello {{CustomerName}},

Warm festival wishes from {{BusinessName}}! 🎉

Wishing you and your family health, happiness, and success.

Regards,
{{SalesExecutive}}`,
  },
  {
    name: "Thank You Message",
    category: "General",
    body: `Hello {{CustomerName}},

Thank you for your time and trust in {{BusinessName}}.

Please find the materials attached. We're always here to help.

Regards,
{{SalesExecutive}}`,
  },
];

async function requireBusiness(userId: string): Promise<string> {
  const businessId = await getUserBusinessId(userId);
  if (!businessId) throw new Error("Workspace required");
  return businessId;
}

function canManageGlobal(role: string): boolean {
  return ADMIN_ROLES.has(role) || role.includes("admin");
}

/** Protect {{vars}} before AI rewrite / translate */
export function protectTemplateVars(text: string): {
  protectedText: string;
  tokens: Map<string, string>;
} {
  const tokens = new Map<string, string>();
  let i = 0;
  const protectedText = String(text || "").replace(
    /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g,
    (full) => {
      const key = `⟦VAR${i++}⟧`;
      tokens.set(key, full);
      return key;
    }
  );
  return { protectedText, tokens };
}

export function restoreTemplateVars(
  text: string,
  tokens: Map<string, string>
): string {
  let out = String(text || "");
  for (const [key, original] of tokens) {
    out = out.split(key).join(original);
  }
  // Safety: remove any leaked AI artifacts that look like broken vars
  return out.trim();
}

export async function ensureDefaultCaptionTemplates(userId: string) {
  const businessId = await requireBusiness(userId);
  const count = await prisma.whatsAppCaptionTemplate.count({
    where: { businessId, isGlobal: true },
  });
  if (count > 0) return;
  await prisma.whatsAppCaptionTemplate.createMany({
    data: DEFAULT_TEMPLATES.map((t, i) => ({
      businessId,
      name: t.name,
      body: t.body,
      category: t.category,
      language: "en",
      isGlobal: true,
      userId: null,
      sortOrder: i,
      createdByUserId: userId,
    })),
  });
}

export async function listCaptionTemplates(
  userId: string,
  opts?: { category?: string; scope?: "all" | "global" | "personal" }
) {
  const businessId = await requireBusiness(userId);
  await ensureDefaultCaptionTemplates(userId);

  const where: Record<string, unknown> = {
    businessId,
    OR: [{ isGlobal: true }, { userId }],
  };
  if (opts?.scope === "global") {
    delete where.OR;
    where.isGlobal = true;
  } else if (opts?.scope === "personal") {
    delete where.OR;
    where.userId = userId;
    where.isGlobal = false;
  }
  if (opts?.category?.trim()) {
    where.category = opts.category.trim();
  }

  const items = await prisma.whatsAppCaptionTemplate.findMany({
    where: where as never,
    orderBy: [{ isGlobal: "desc" }, { useCount: "desc" }, { name: "asc" }],
    take: 200,
  });

  return {
    categories: [...CATEGORIES],
    templates: items.map(serializeTemplate),
  };
}

function serializeTemplate(t: {
  id: string;
  name: string;
  body: string;
  category: string;
  language: string;
  isGlobal: boolean;
  userId: string | null;
  useCount: number;
  lastUsedAt: Date | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: t.id,
    name: t.name,
    body: t.body,
    category: t.category,
    language: t.language,
    isGlobal: t.isGlobal,
    isPersonal: !t.isGlobal && !!t.userId,
    userId: t.userId,
    useCount: t.useCount,
    lastUsedAt: t.lastUsedAt?.toISOString() || null,
    sortOrder: t.sortOrder,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function createCaptionTemplate(
  userId: string,
  input: {
    name: string;
    body: string;
    category?: string;
    language?: string;
    isGlobal?: boolean;
  }
) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  const name = String(input.name || "").trim().slice(0, 120);
  const body = String(input.body || "").trim();
  if (!name) throw new Error("Template name is required");
  if (!body) throw new Error("Template body is required");
  if (body.length > 4096) throw new Error("Template exceeds 4096 characters");

  const wantGlobal = !!input.isGlobal;
  if (wantGlobal && !canManageGlobal(role)) {
    throw new Error("Only Business Admin can create global templates");
  }

  const category = CATEGORIES.includes(input.category as never)
    ? (input.category as string)
    : "General";
  const language = ["en", "te", "hi"].includes(input.language || "")
    ? (input.language as string)
    : "en";

  const row = await prisma.whatsAppCaptionTemplate.create({
    data: {
      businessId,
      userId: wantGlobal ? null : userId,
      isGlobal: wantGlobal,
      name,
      body,
      category,
      language,
      createdByUserId: userId,
    },
  });
  return serializeTemplate(row);
}

export async function updateCaptionTemplate(
  userId: string,
  templateId: string,
  input: {
    name?: string;
    body?: string;
    category?: string;
    language?: string;
  }
) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  const existing = await prisma.whatsAppCaptionTemplate.findFirst({
    where: { id: templateId, businessId },
  });
  if (!existing) throw new Error("Template not found");

  if (existing.isGlobal) {
    if (!canManageGlobal(role)) {
      throw new Error("Only Business Admin can edit global templates");
    }
  } else if (existing.userId !== userId) {
    throw new Error("You can only edit your own personal templates");
  }

  const data: Record<string, unknown> = {};
  if (input.name != null) data.name = String(input.name).trim().slice(0, 120);
  if (input.body != null) {
    const body = String(input.body).trim();
    if (body.length > 4096) throw new Error("Template exceeds 4096 characters");
    data.body = body;
  }
  if (input.category != null && CATEGORIES.includes(input.category as never)) {
    data.category = input.category;
  }
  if (input.language != null && ["en", "te", "hi"].includes(input.language)) {
    data.language = input.language;
  }

  const row = await prisma.whatsAppCaptionTemplate.update({
    where: { id: templateId },
    data: data as never,
  });
  return serializeTemplate(row);
}

export async function deleteCaptionTemplate(userId: string, templateId: string) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  const existing = await prisma.whatsAppCaptionTemplate.findFirst({
    where: { id: templateId, businessId },
  });
  if (!existing) throw new Error("Template not found");
  if (existing.isGlobal) {
    if (!canManageGlobal(role)) {
      throw new Error("Only Business Admin can delete global templates");
    }
  } else if (existing.userId !== userId) {
    throw new Error("You can only delete your own personal templates");
  }
  await prisma.whatsAppCaptionTemplate.delete({ where: { id: templateId } });
  return { deleted: true };
}

export async function markTemplateUsed(userId: string, templateId: string) {
  const businessId = await requireBusiness(userId);
  const existing = await prisma.whatsAppCaptionTemplate.findFirst({
    where: {
      id: templateId,
      businessId,
      OR: [{ isGlobal: true }, { userId }],
    },
  });
  if (!existing) return null;
  const row = await prisma.whatsAppCaptionTemplate.update({
    where: { id: templateId },
    data: {
      useCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
  return serializeTemplate(row);
}

export async function listRecentTemplates(userId: string, limit = 8) {
  const businessId = await requireBusiness(userId);
  await ensureDefaultCaptionTemplates(userId);
  const items = await prisma.whatsAppCaptionTemplate.findMany({
    where: {
      businessId,
      lastUsedAt: { not: null },
      OR: [{ isGlobal: true }, { userId }],
    },
    orderBy: { lastUsedAt: "desc" },
    take: Math.min(20, Math.max(1, limit)),
  });
  return items.map(serializeTemplate);
}

/** AI: rewrite professionally, keep {{variables}} intact */
export async function improveCaptionWithAI(
  userId: string,
  caption: string
): Promise<{ text: string }> {
  await requireBusiness(userId);
  const raw = String(caption || "").trim();
  if (!raw) throw new Error("Caption is empty");
  if (raw.length > 4096) throw new Error("Caption is too long");

  const { protectedText, tokens } = protectTemplateVars(raw);
  const ai = await getAIService();
  const prompt = `You are an expert B2B sales copywriter for WhatsApp messages.

Rewrite the following WhatsApp caption into a more professional, warm, and concise sales message.

CRITICAL RULES:
1. Keep every token that looks like ⟦VARn⟧ EXACTLY as-is — do not translate, remove, or alter them.
2. Do not invent new placeholders.
3. Keep the same general intent.
4. Output ONLY the rewritten message text — no quotes, no markdown, no explanation.

Caption to improve:
${protectedText}`;

  const res = await ai.generateText(prompt, { temperature: 0.4, maxTokens: 800 });
  const improved = restoreTemplateVars(String(res.data || "").trim(), tokens);
  if (!improved) throw new Error("AI returned empty result");
  return { text: improved.slice(0, 4096) };
}

/** AI: translate to en | te | hi, keep {{variables}} intact */
export async function translateCaption(
  userId: string,
  caption: string,
  language: "en" | "te" | "hi"
): Promise<{ text: string; language: string }> {
  await requireBusiness(userId);
  const raw = String(caption || "").trim();
  if (!raw) throw new Error("Caption is empty");

  const langLabel =
    language === "te" ? "Telugu" : language === "hi" ? "Hindi" : "English";

  const { protectedText, tokens } = protectTemplateVars(raw);
  const ai = await getAIService();
  const prompt = `Translate the following WhatsApp sales message into ${langLabel}.

CRITICAL RULES:
1. Keep every token that looks like ⟦VARn⟧ EXACTLY as-is — never translate placeholders.
2. Preserve line breaks and greeting/closing structure where natural.
3. Output ONLY the translated message — no quotes, no notes.

Message:
${protectedText}`;

  const res = await ai.generateText(prompt, { temperature: 0.3, maxTokens: 800 });
  const text = restoreTemplateVars(String(res.data || "").trim(), tokens);
  if (!text) throw new Error("Translation failed");
  return { text: text.slice(0, 4096), language };
}

// ─── Signature settings ─────────────────────────────────────────────────────

export async function getMessagingSettings(userId: string) {
  const businessId = await requireBusiness(userId);
  const [user, business] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        phone: true,
        email: true,
        whatsappSignature: true,
        whatsappSignatureEnabled: true,
        role: true,
      },
    }),
    prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, settings: true },
    }),
  ]);

  const settings = (business?.settings || {}) as Record<string, unknown>;
  const autoSignature =
    settings.whatsappAutoSignature === undefined
      ? true
      : !!settings.whatsappAutoSignature;

  const defaultSig = buildDefaultSignature({
    name: user?.name,
    phone: user?.phone,
    email: user?.email,
    businessName: business?.name,
    role: user?.role,
  });

  return {
    autoSignatureEnabled: autoSignature,
    signatureEnabled: user?.whatsappSignatureEnabled !== false,
    signature: (user?.whatsappSignature || "").trim() || defaultSig,
    defaultSignature: defaultSig,
    canManageAutoSignature: canManageGlobal(await resolveActorRole(userId)),
  };
}

function buildDefaultSignature(opts: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  businessName?: string | null;
  role?: string | null;
}): string {
  const name = (opts.name || "").trim() || "Sales";
  const roleLabel = formatRole(opts.role);
  const lines = ["Regards,", "", name];
  if (roleLabel) lines.push(roleLabel);
  if (opts.businessName?.trim()) lines.push(opts.businessName.trim());
  if (opts.phone?.trim()) lines.push(opts.phone.trim());
  return lines.join("\n");
}

function formatRole(role?: string | null): string {
  if (!role) return "";
  const map: Record<string, string> = {
    sales_executive: "Sales Executive",
    sales_manager: "Sales Manager",
    business_admin: "Business Admin",
    manager: "Sales Manager",
    ceo: "CEO",
    owner: "Owner",
  };
  return map[role] || role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function updateMessagingSettings(
  userId: string,
  input: {
    signature?: string | null;
    signatureEnabled?: boolean;
    autoSignatureEnabled?: boolean;
  }
) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);

  if (input.signature !== undefined || input.signatureEnabled !== undefined) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.signature !== undefined
          ? { whatsappSignature: String(input.signature || "").slice(0, 1000) }
          : {}),
        ...(input.signatureEnabled !== undefined
          ? { whatsappSignatureEnabled: !!input.signatureEnabled }
          : {}),
      },
    });
  }

  if (input.autoSignatureEnabled !== undefined) {
    if (!canManageGlobal(role)) {
      throw new Error("Only Business Admin can change global signature policy");
    }
    const biz = await prisma.business.findUnique({
      where: { id: businessId },
      select: { settings: true },
    });
    const settings = {
      ...((biz?.settings as object) || {}),
      whatsappAutoSignature: !!input.autoSignatureEnabled,
    };
    await prisma.business.update({
      where: { id: businessId },
      data: { settings },
    });
  }

  return getMessagingSettings(userId);
}

/**
 * Apply signature to a caption when workspace + user settings allow it.
 * Avoids double-append if caption already ends with signature block.
 */
export async function applyWhatsAppSignature(
  userId: string,
  caption: string
): Promise<string> {
  const settings = await getMessagingSettings(userId);
  if (!settings.autoSignatureEnabled || !settings.signatureEnabled) {
    return caption;
  }
  const sig = (settings.signature || "").trim();
  if (!sig) return caption;
  const body = (caption || "").trim();
  if (!body) return sig;
  if (body.includes(sig.split("\n")[0] || "Regards") && body.endsWith(sig.slice(-20))) {
    return body;
  }
  // Simple duplicate guard
  if (body.endsWith(sig)) return body;
  return `${body}\n\n${sig}`.slice(0, 4096);
}

/** Final render for send: variables + optional signature */
export async function finalizeWhatsAppCaption(opts: {
  userId: string;
  contactId: string;
  businessId: string;
  caption: string;
}): Promise<string> {
  const { buildContactTemplateVars } = await import("./template-vars.service.js");
  const vars = await buildContactTemplateVars({
    contactId: opts.contactId,
    actorUserId: opts.userId,
    businessId: opts.businessId,
  });
  let text = renderTemplate(opts.caption || "", vars);
  text = await applyWhatsAppSignature(opts.userId, text);
  return text;
}
