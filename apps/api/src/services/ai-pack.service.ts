import { getBusinessConfig } from "@/services/template.service";
import { getUserBusinessId } from "@/services/field-engine.service";

export type AiFeatureDef = {
  key: string;
  label: string;
  enabled: boolean;
  promptTemplate: string;
  output: "text" | "json";
  jsonSchemaHint?: string;
  ui?: { toneOptions?: string[]; languages?: string[]; entity?: string };
};

/**
 * Resolve AI feature definition from BusinessConfig.aiPromptPack (config-driven).
 * Returns null when missing — callers use legacy prompts as temporary fallback.
 */
export async function resolveAiFeature(
  userId: string,
  featureKey: string
): Promise<{ feature: AiFeatureDef; systemContext: string } | null> {
  const businessId = await getUserBusinessId(userId);
  if (!businessId) return null;
  const config = await getBusinessConfig(businessId);
  if (!config?.aiPromptPack || typeof config.aiPromptPack !== "object") return null;

  const pack = config.aiPromptPack as {
    systemContext?: string;
    features?: AiFeatureDef[];
  };
  const feature = (pack.features || []).find((f) => f.key === featureKey && f.enabled !== false);
  if (!feature) return null;
  return {
    feature,
    systemContext: pack.systemContext || "",
  };
}

export async function listEnabledAiFeatures(userId: string): Promise<AiFeatureDef[]> {
  const businessId = await getUserBusinessId(userId);
  if (!businessId) return [];
  const config = await getBusinessConfig(businessId);
  const pack = config?.aiPromptPack as { features?: AiFeatureDef[] } | null;
  if (!pack?.features) return [];
  return pack.features.filter((f) => f.enabled !== false);
}

/** Fill {{placeholders}} in pack templates from a context bag */
export function fillAiTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  });
}
