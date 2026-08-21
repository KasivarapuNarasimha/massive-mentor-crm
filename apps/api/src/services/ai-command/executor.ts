import { ACTION_REGISTRY } from "./registry.js";
import { assertActionAllowed } from "./permissions.js";
import { issueConfirmToken } from "./confirm-store.js";
import type {
  ActionContext,
  ActionPlan,
  CommandResult,
  PlanStep,
  StepResult,
} from "./types.js";

function cardFromStep(step: StepResult): CommandResult["cards"][0] | null {
  if (step.status !== "ok" && step.status !== "needs_confirmation") return null;
  return {
    title: step.label || step.action,
    subtitle: step.message,
    fields: step.fields,
    actions: step.actions?.map((a) => ({
      ...a,
      confirmToken: step.confirmToken,
    })),
  };
}

/**
 * LLM often puts soft-refs `{ by, query }` into string fields (company/name/dueDate).
 * Coerce those to usable primitives before zod — does not invent values.
 */
function coercePlannerArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const [k, v] of Object.entries(out)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      // Soft entity ref left as-is for contact/deal/assignee/product/invoice/meeting
      if (["contact", "deal", "assignee", "product", "invoice", "meeting"].includes(k)) {
        continue;
      }
      if (typeof obj.query === "string") {
        // String-ish fields: company, name, title, phone, etc.
        if (k === "due" || k === "dueDate" || k === "when" || k === "expectedClose") {
          out[k] = obj; // keep relative date object for resolveDueDate
        } else if ("relative" in obj || "days" in obj || "time" in obj || "iso" in obj) {
          out[k] = obj;
        } else {
          out[k] = obj.query;
        }
      } else if ("relative" in obj || "days" in obj || "time" in obj || "iso" in obj) {
        if (k === "dueDate") {
          // Prefer due for relative objects
          out.due = obj;
          delete out.dueDate;
        }
      }
    }
  }
  // Promote identity hints into contact when planner omitted contact soft-ref.
  const contactEmpty =
    out.contact == null ||
    out.contact === "" ||
    (typeof out.contact === "object" &&
      out.contact !== null &&
      !(out.contact as { id?: string; query?: string; from?: string }).id &&
      !(out.contact as { query?: string }).query &&
      !(out.contact as { from?: string }).from);
  if (contactEmpty) {
    for (const key of ["clientName", "company", "client"] as const) {
      const v = out[key];
      if (typeof v === "string" && v.trim()) {
        out.contact = { by: "company_or_name", query: v.trim() };
        break;
      }
    }
  }
  return out;
}

async function runOneStep(
  ctx: ActionContext,
  step: PlanStep
): Promise<StepResult> {
  const def = ACTION_REGISTRY[step.action];
  if (!def) {
    return {
      id: step.id,
      action: step.action,
      status: "failed",
      message: `Unknown action "${step.action}"`,
    };
  }

  const perm = assertActionAllowed(ctx, def);
  if (!perm.ok) {
    return { id: step.id, action: step.action, status: "failed", message: perm.error };
  }

  let args: Record<string, unknown>;
  try {
    args = def.argsSchema.parse(coercePlannerArgs(step.args || {})) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid arguments";
    return { id: step.id, action: step.action, status: "failed", message: msg };
  }

  if (def.resolveArgs) {
    const resolved = await def.resolveArgs(ctx, args as never);
    if (!resolved.ok) {
      if (resolved.status === "needs_choice") {
        return {
          id: step.id,
          action: step.action,
          status: "needs_choice",
          message: resolved.message,
          choices: resolved.choices,
        };
      }
      if (resolved.status === "needs_input") {
        return {
          id: step.id,
          action: step.action,
          status: "needs_input",
          message: resolved.message,
          missingFields: resolved.missingFields,
        };
      }
      return { id: step.id, action: step.action, status: "failed", message: resolved.message };
    }
    args = resolved.args as Record<string, unknown>;
  }

  if (def.risk === "destructive" || def.risk === "high") {
    const token = issueConfirmToken({
      userId: ctx.userId,
      businessId: ctx.businessId,
      action: def.name,
      args,
      message: `Confirm ${def.name}`,
    });
    return {
      id: step.id,
      action: step.action,
      status: "needs_confirmation",
      message: `⚠️ Confirmation required to ${def.description}`,
      confirmToken: token,
      fields: Object.entries(args)
        .filter(([k]) => !k.startsWith("_"))
        .slice(0, 8)
        .map(([k, v]) => ({ label: k, value: typeof v === "object" ? JSON.stringify(v) : String(v ?? "") })),
      actions: [{ label: "Confirm", confirmToken: token } as never],
    };
  }

  try {
    const result = await def.execute(ctx, args as never);
    if (def.verify) {
      const v = await def.verify(ctx, args as never, result);
      if (!v.ok) {
        return {
          id: step.id,
          action: step.action,
          status: "verify_failed",
          message: v.message,
          entityId: result.entityId,
          entityType: result.entityType,
        };
      }
    }
    if (step.saveAs && result.entityId) {
      ctx.bindings[step.saveAs] = {
        type: result.entityType || "entity",
        id: result.entityId,
        label: result.label || result.entityId,
        raw: result.data,
      };
    }
    return {
      id: step.id,
      action: step.action,
      status: "ok",
      message: result.message,
      entityType: result.entityType,
      entityId: result.entityId,
      label: result.label,
      fields: result.fields,
      actions: result.actions,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Action failed";
    return { id: step.id, action: step.action, status: "failed", message: msg };
  }
}

export async function executePlan(
  ctx: ActionContext,
  plan: ActionPlan,
  opts?: { startIndex?: number; sessionId: string }
): Promise<CommandResult> {
  const steps = plan.steps || [];
  const results: StepResult[] = [];
  let i = opts?.startIndex || 0;

  if (plan.ask?.type === "unsupported") {
    return {
      status: "unsupported",
      summary: plan.ask.message,
      steps: [],
      cards: [],
      sessionId: opts?.sessionId || "default",
    };
  }

  for (; i < steps.length; i++) {
    const step = steps[i];
    // Rewrite soft refs from: saveAs
    const args = { ...step.args };
    for (const [k, v] of Object.entries(args)) {
      if (v && typeof v === "object" && "from" in (v as object)) {
        const from = String((v as { from: string }).from);
        const bound = ctx.bindings[from];
        if (bound) args[k] = { id: bound.id };
      }
    }
    const result = await runOneStep(ctx, { ...step, args });
    results.push(result);

    if (result.status === "needs_choice" || result.status === "needs_input") {
      return {
        status: result.status,
        summary: result.message,
        steps: results,
        cards: results.map(cardFromStep).filter(Boolean) as CommandResult["cards"],
        choices: result.choices,
        missingFields: result.missingFields,
        sessionId: opts?.sessionId || "default",
      };
    }
    if (result.status === "needs_confirmation") {
      return {
        status: "needs_confirmation",
        summary: result.message,
        steps: results,
        cards: results.map(cardFromStep).filter(Boolean) as CommandResult["cards"],
        confirmToken: result.confirmToken,
        sessionId: opts?.sessionId || "default",
      };
    }
    if (result.status === "failed" || result.status === "verify_failed") {
      const okCount = results.filter((r) => r.status === "ok").length;
      return {
        status: okCount ? "partial" : "failed",
        summary: `Stopped after ${okCount} success(es). Failed: ${result.message}`,
        steps: results,
        cards: results.map(cardFromStep).filter(Boolean) as CommandResult["cards"],
        sessionId: opts?.sessionId || "default",
      };
    }
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  return {
    status: "completed",
    summary:
      okCount === 0
        ? plan.ask?.message || "No actions executed"
        : `Completed ${okCount} action(s)`,
    steps: results,
    cards: results.map(cardFromStep).filter(Boolean) as CommandResult["cards"],
    sessionId: opts?.sessionId || "default",
  };
}

export async function executeConfirmedAction(
  ctx: ActionContext,
  actionName: string,
  args: Record<string, unknown>
): Promise<StepResult> {
  const def = ACTION_REGISTRY[actionName];
  if (!def) {
    return { id: "confirm", action: actionName, status: "failed", message: "Unknown action" };
  }
  const perm = assertActionAllowed(ctx, def);
  if (!perm.ok) {
    return { id: "confirm", action: actionName, status: "failed", message: perm.error };
  }
  try {
    const parsed = def.argsSchema.parse(args);
    const result = await def.execute(ctx, parsed as never);
    if (def.verify) {
      const v = await def.verify(ctx, parsed as never, result);
      if (!v.ok) {
        return {
          id: "confirm",
          action: actionName,
          status: "verify_failed",
          message: v.message,
        };
      }
    }
    return {
      id: "confirm",
      action: actionName,
      status: "ok",
      message: result.message,
      entityType: result.entityType,
      entityId: result.entityId,
      label: result.label,
      fields: result.fields,
      actions: result.actions,
    };
  } catch (e) {
    return {
      id: "confirm",
      action: actionName,
      status: "failed",
      message: e instanceof Error ? e.message : "Failed",
    };
  }
}
