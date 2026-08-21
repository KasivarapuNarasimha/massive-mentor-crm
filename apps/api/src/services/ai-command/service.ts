import { randomUUID } from "crypto";
import { buildActionContext } from "./permissions.js";
import { planFromMessage } from "./planner.js";
import { executePlan, executeConfirmedAction } from "./executor.js";
import { getOrCreateSession, touchSession, clearPending } from "./session-store.js";
import { verifyConfirmToken } from "./confirm-store.js";
import { ACTION_REGISTRY } from "./registry.js";
import type { CommandResult } from "./types.js";

export async function runAiCommand(input: {
  userId: string;
  message: string;
  sessionId?: string;
  choices?: Record<string, string>;
  locale?: string;
}): Promise<CommandResult> {
  const sessionId = input.sessionId || randomUUID();
  const session = getOrCreateSession(input.userId, sessionId);
  const ctx = await buildActionContext(input.userId, input.locale);
  ctx.bindings = { ...session.bindings };

  // Apply UI choices into pending plan if any
  if (input.choices && session.pending?.plan) {
    const step = session.pending.plan.steps[session.pending.stepIndex];
    if (step) {
      for (const [field, id] of Object.entries(input.choices)) {
        step.args[field] = { id };
      }
    }
    const result = await executePlan(ctx, session.pending.plan, {
      startIndex: session.pending.stepIndex,
      sessionId,
    });
    session.bindings = { ...ctx.bindings };
    session.history.push({ role: "user", content: input.message || "(choice)" });
    session.history.push({ role: "assistant", content: result.summary });
    if (result.status === "needs_choice" || result.status === "needs_input" || result.status === "needs_confirmation") {
      session.pending = {
        type: result.status,
        plan: session.pending.plan,
        stepIndex: session.pending.stepIndex,
        choices: result.choices,
        missingFields: result.missingFields,
        confirmToken: result.confirmToken,
        lastEntities: session.bindings,
      };
    } else {
      session.pending = null;
    }
    touchSession(input.userId, sessionId, session);
    return { ...result, sessionId };
  }

  // Continuation for missing fields: treat message as filling pending
  if (session.pending?.type === "needs_input" && session.pending.plan) {
    session.history.push({ role: "user", content: input.message });
    // Re-plan with history so LLM merges missing fields
  }

  session.history.push({ role: "user", content: input.message });
  let plan = await planFromMessage(ctx, input.message, session.history);

  // If planner asked a vague delete confirmation instead of emitting delete_* action,
  // synthesize delete_contact from the user message (server still requires confirmToken).
  const msgLower = input.message.toLowerCase();
  if (
    (!plan.steps || plan.steps.length === 0) &&
    plan.ask &&
    /delete|remove|తొలగించ|delete cheyyi/.test(msgLower)
  ) {
    const q =
      (input.message.match(/([A-Za-z][A-Za-z0-9 .&_-]{1,60})/)?.[1] || "ABC").trim() ||
      "ABC";
    plan = {
      intent: "delete_contact",
      steps: [
        {
          id: "s1",
          action: "delete_contact",
          args: { contact: { by: "company_or_name", query: q.replace(/\s+(ni|nu|delete|cheyyi).*$/i, "").trim() || q } },
        },
      ],
      ask: null,
    };
  }

  if (plan.ask?.type === "unsupported") {
    const result: CommandResult = {
      status: "unsupported",
      summary: plan.ask.message || "That operation is not supported yet.",
      steps: [],
      cards: [],
      sessionId,
    };
    session.history.push({ role: "assistant", content: result.summary });
    session.pending = null;
    touchSession(input.userId, sessionId, session);
    return result;
  }

  if ((!plan.steps || plan.steps.length === 0) && plan.ask) {
    const result: CommandResult = {
      status: plan.ask.type === "choice" ? "needs_choice" : "needs_input",
      summary: plan.ask.message,
      steps: [],
      cards: [],
      missingFields: plan.ask.missingFields,
      choices: plan.ask.choices,
      sessionId,
    };
    session.pending = {
      type: result.status as "needs_input" | "needs_choice",
      plan,
      stepIndex: 0,
      missingFields: result.missingFields,
      choices: result.choices,
      lastEntities: session.bindings,
    };
    session.history.push({ role: "assistant", content: result.summary });
    touchSession(input.userId, sessionId, session);
    return result;
  }

  // Validate action names exist
  for (const s of plan.steps) {
    if (!ACTION_REGISTRY[s.action]) {
      const result: CommandResult = {
        status: "failed",
        summary: `Planner proposed unsupported action "${s.action}".`,
        steps: [],
        cards: [],
        sessionId,
      };
      session.history.push({ role: "assistant", content: result.summary });
      touchSession(input.userId, sessionId, session);
      return result;
    }
  }

  const result = await executePlan(ctx, plan, { sessionId });
  session.bindings = { ...ctx.bindings };
  session.history.push({ role: "assistant", content: result.summary });

  if (result.status === "needs_choice" || result.status === "needs_input" || result.status === "needs_confirmation") {
    const stepIndex = Math.max(0, result.steps.length - 1);
    session.pending = {
      type: result.status,
      plan,
      stepIndex,
      choices: result.choices,
      missingFields: result.missingFields,
      confirmToken: result.confirmToken,
      lastEntities: session.bindings,
    };
  } else {
    session.pending = null;
  }
  touchSession(input.userId, sessionId, session);
  return { ...result, sessionId };
}

export async function confirmAiCommand(input: {
  userId: string;
  confirmToken: string;
  sessionId?: string;
}): Promise<CommandResult> {
  const sessionId = input.sessionId || "default";
  const ctx = await buildActionContext(input.userId);
  const verified = verifyConfirmToken(input.confirmToken, input.userId, ctx.businessId);
  if (!verified.ok) {
    return {
      status: "failed",
      summary: verified.error,
      steps: [],
      cards: [],
      sessionId,
    };
  }
  const step = await executeConfirmedAction(ctx, verified.payload.action, verified.payload.args);
  clearPending(input.userId, sessionId);
  return {
    status: step.status === "ok" ? "completed" : "failed",
    summary: step.message,
    steps: [step],
    cards:
      step.status === "ok"
        ? [
            {
              title: step.label || step.action,
              subtitle: step.message,
              fields: step.fields,
              actions: step.actions,
            },
          ]
        : [],
    sessionId,
  };
}
