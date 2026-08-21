import type { z } from "zod";

export type SoftRef =
  | { by: "company_or_name" | "name" | "phone" | "query" | "number" | "sku"; query: string }
  | { from: string }
  | { id: string }
  | string
  | null
  | undefined;

export type ActionRisk = "low" | "high" | "destructive";
export type ActionCategory = "crm" | "finance" | "erp" | "comms" | "insights";

export type ActionContext = {
  userId: string;
  businessId: string | null;
  role: string;
  moduleKeys: string[];
  locale?: string;
  now: Date;
  bindings: Record<string, { type: string; id: string; label: string; raw?: unknown }>;
};

export type ChoiceOption = {
  id: string;
  label: string;
  sublabel?: string;
  field?: string;
};

export type ResolveOutcome<T> =
  | { ok: true; args: T }
  | { ok: false; status: "needs_choice"; message: string; choices: ChoiceOption[]; field?: string }
  | { ok: false; status: "needs_input"; message: string; missingFields: string[] }
  | { ok: false; status: "not_found"; message: string };

export type ExecuteResult = {
  message: string;
  entityType?: string;
  entityId?: string;
  label?: string;
  data?: Record<string, unknown>;
  href?: string;
  fields?: Array<{ label: string; value: string }>;
  actions?: Array<{ label: string; href?: string; command?: string }>;
};

export type VerifyResult = { ok: true } | { ok: false; message: string };

export type ActionDef<T = Record<string, unknown>> = {
  name: string;
  description: string;
  category: ActionCategory;
  risk: ActionRisk;
  modules: string[];
  roles?: string[];
  argsSchema: z.ZodType<T>;
  resolveArgs?: (ctx: ActionContext, args: T) => Promise<ResolveOutcome<T>>;
  execute: (ctx: ActionContext, args: T) => Promise<ExecuteResult>;
  verify?: (ctx: ActionContext, args: T, result: ExecuteResult) => Promise<VerifyResult>;
};

export type PlanStep = {
  id: string;
  action: string;
  args: Record<string, unknown>;
  saveAs?: string;
};

export type ActionPlan = {
  intent?: string;
  language?: string;
  steps: PlanStep[];
  ask?: {
    type: "missing_fields" | "choice" | "unsupported";
    message: string;
    missingFields?: string[];
    choices?: ChoiceOption[];
  } | null;
};

export type StepResult = {
  id: string;
  action: string;
  status: "ok" | "failed" | "verify_failed" | "skipped" | "needs_choice" | "needs_input" | "needs_confirmation";
  message: string;
  entityType?: string;
  entityId?: string;
  label?: string;
  fields?: Array<{ label: string; value: string }>;
  actions?: Array<{ label: string; href?: string; command?: string; confirmToken?: string }>;
  confirmToken?: string;
  choices?: ChoiceOption[];
  missingFields?: string[];
};

export type CommandResult = {
  status: "completed" | "partial" | "needs_input" | "needs_choice" | "needs_confirmation" | "unsupported" | "failed";
  summary: string;
  steps: StepResult[];
  cards: Array<{
    title: string;
    subtitle?: string;
    fields?: Array<{ label: string; value: string }>;
    actions?: Array<{ label: string; href?: string; command?: string; confirmToken?: string }>;
  }>;
  confirmToken?: string;
  choices?: ChoiceOption[];
  missingFields?: string[];
  sessionId: string;
};
