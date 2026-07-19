import { z } from "zod";

/** Generic field / widget / trigger types only — never industry-specific enums in code paths. */

export const fieldTypeSchema = z.enum([
  "text",
  "number",
  "currency",
  "phone",
  "email",
  "date",
  "datetime",
  "select",
  "multiselect",
  "boolean",
  "textarea",
  "url",
  "rating",
  "nps",
]);

export const fieldDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  entity: z.enum(["contact", "deal", "task", "meeting", "feedback"]),
  type: fieldTypeSchema,
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  coreMap: z
    .enum(["name", "phone", "email", "company", "value", "status", "title", "description"])
    .optional(),
  showInList: z.boolean().optional(),
  showInForm: z.boolean().optional(),
  showInFilter: z.boolean().optional(),
  showInDetail: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  order: z.number(),
});

export const moduleDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  enabled: z.boolean(),
  route: z.string().optional(),
  order: z.number(),
});

export const pipelineStatusSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  order: z.number(),
});

export const pipelineDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  entity: z.enum(["contact", "deal"]),
  statuses: z.array(pipelineStatusSchema).min(1),
});

export const widgetFilterSchema = z.object({
  field: z.string(),
  op: z.enum(["eq", "neq", "gt", "lt", "gte", "lte", "in", "is_null", "not_null"]),
  value: z.unknown().optional(),
});

export const widgetSourceSchema = z.object({
  entity: z.enum(["contact", "deal", "task", "meeting", "feedback"]),
  filters: z.array(widgetFilterSchema).optional(),
  aggregate: z.enum(["count", "sum", "avg"]).optional(),
  aggregateField: z.string().optional(),
  /** Group-by field for charts (status, stage, type, customFields.key) */
  groupBy: z.string().optional(),
  limit: z.number().optional(),
  /** Optional date field for range filters (createdAt, updatedAt, dueDate, scheduledAt) */
  dateField: z.string().optional(),
});

export const chartTypeSchema = z.enum([
  "bar",
  "line",
  "pie",
  "area",
  "donut",
  "funnel",
  "gauge",
]);

export const widgetDefSchema = z.object({
  key: z.string().min(1),
  type: z.enum([
    "metric_count",
    "metric_sum",
    "metric_kpi",
    "list",
    "pipeline_funnel",
    "tasks_due",
    "nps_average",
    "feedback_recent",
    "chart",
  ]),
  title: z.string().min(1),
  description: z.string().optional(),
  /** When type=chart */
  chartType: chartTypeSchema.optional(),
  source: widgetSourceSchema,
  layout: z.object({
    w: z.number(),
    h: z.number(),
    x: z.number(),
    y: z.number(),
  }),
  /** Role keys that can see this widget; empty/undefined = all roles on dashboard */
  rolesCanView: z.array(z.string()).optional(),
  /** Enable client drill-down to entity list filtered by group key */
  drillDown: z
    .object({
      enabled: z.boolean(),
      entity: z.string().optional(),
      route: z.string().optional(),
    })
    .optional(),
  /** Default date range preset for this widget */
  dateRange: z
    .object({
      preset: z.enum(["all", "7d", "30d", "90d", "ytd", "custom"]).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .optional(),
});

export const dashboardDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  /** Which roles see this dashboard by default */
  roles: z.array(z.string()).optional(),
  isDefault: z.boolean().optional(),
  widgets: z.array(widgetDefSchema),
});

export const reportDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  entity: z.string().min(1),
  columns: z.array(z.string()),
  defaultFilters: z.array(z.unknown()).optional(),
});

export const automationDefSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  trigger: z.object({
    type: z.string().min(1),
    config: z.record(z.unknown()).optional(),
  }),
  conditions: z
    .array(
      z.object({
        field: z.string(),
        op: z.string(),
        value: z.unknown().optional(),
      })
    )
    .optional(),
  actions: z.array(
    z.object({
      type: z.string().min(1),
      config: z.record(z.unknown()),
    })
  ),
});

export const notificationDefSchema = z.object({
  key: z.string().min(1),
  channel: z.enum(["in_app", "email", "whatsapp", "sms", "push"]),
  event: z.string().min(1),
  template: z.string().min(1),
});

export const aiFeatureSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  enabled: z.boolean(),
  promptTemplate: z.string().min(1),
  output: z.enum(["text", "json"]),
  jsonSchemaHint: z.string().optional(),
  ui: z
    .object({
      toneOptions: z.array(z.string()).optional(),
      languages: z.array(z.string()).optional(),
      entity: z.string().optional(),
    })
    .optional(),
});

export const aiPromptPackSchema = z.object({
  systemContext: z.string(),
  features: z.array(aiFeatureSchema),
});

export const roleDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  permissions: z.array(z.string()),
});

export const importMappingSchema = z.object({
  sourceHeader: z.string().min(1),
  fieldKey: z.string().min(1),
});

/** Menu item inside a role portal (config-driven navigation) */
export const portalMenuSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  route: z.string().min(1),
  order: z.number(),
  enabled: z.boolean().default(true),
  /** Permission keys required (any); empty = visible if portal matches */
  permissions: z.array(z.string()).optional(),
  icon: z.string().optional(),
});

/** Quick action on a portal home */
export const portalActionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["navigate", "ai_feature", "create", "report", "custom"]),
  route: z.string().optional(),
  featureKey: z.string().optional(),
  permission: z.string().optional(),
  order: z.number().optional(),
});

/**
 * Dedicated portal per role (or custom role).
 * Menus, dashboard, reports, actions — all from config, never hardcoded in UI.
 */
export const portalDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  /** Membership / platform roles that land on this portal */
  roles: z.array(z.string()).min(1),
  homeRoute: z.string().default("/dashboard"),
  defaultDashboardKey: z.string().default("main"),
  menus: z.array(portalMenuSchema),
  actions: z.array(portalActionSchema).optional(),
  reportKeys: z.array(z.string()).optional(),
  /** Extra dashboard keys available in this portal */
  dashboardKeys: z.array(z.string()).optional(),
});

export const industryTemplateManifestSchema = z.object({
  schemaVersion: z.literal(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  modules: z.array(moduleDefSchema),
  fields: z.array(fieldDefSchema),
  pipelines: z.array(pipelineDefSchema),
  dashboards: z.array(dashboardDefSchema),
  reports: z.array(reportDefSchema),
  automations: z.array(automationDefSchema),
  notifications: z.array(notificationDefSchema),
  aiPromptPack: aiPromptPackSchema,
  roles: z.array(roleDefSchema),
  importMappings: z.array(importMappingSchema),
  portals: z.array(portalDefSchema).optional(),
  feedback: z.unknown().optional(),
  whiteLabelDefaults: z.record(z.unknown()).optional(),
  plugins: z
    .array(
      z.object({
        key: z.string(),
        enabled: z.boolean(),
        settings: z.unknown().optional(),
      })
    )
    .optional(),
});

export type IndustryTemplateManifest = z.infer<typeof industryTemplateManifestSchema>;
export type FieldDef = z.infer<typeof fieldDefSchema>;
