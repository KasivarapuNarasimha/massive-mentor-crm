import { getAIService } from "../ai.service.js";
import { sanitizePromptInput } from "../../utils/sanitize.js";
import { listActionCatalog } from "./registry.js";
import { extractHints } from "./i18n-normalize.js";
import { listAssignableMembers } from "../lead-assignment.service.js";
import type { ActionContext, ActionPlan } from "./types.js";

function catalogText(): string {
  return listActionCatalog()
    .map((a) => `- ${a.name} [${a.category}]: ${a.description}`)
    .join("\n");
}

export async function planFromMessage(
  ctx: ActionContext,
  message: string,
  history: Array<{ role: string; content: string }>
): Promise<ActionPlan> {
  const hints = extractHints(message);
  let memberHint = "";
  try {
    const members = await listAssignableMembers(ctx.userId);
    memberHint = members
      .slice(0, 30)
      .map((m) => `${m.name || m.email}`)
      .join(", ");
  } catch {
    memberHint = "(assignee list unavailable — omit assignedTo or use current user)";
  }

  const system = `You are Massive Mentor Action Planner. Convert the user command into a JSON action plan for a CRM+ERP system.

Rules:
- Output a single JSON object only.
- Use ONLY these actions:
${catalogText()}
- Prefer soft entity refs: { "by": "company_or_name", "query": "ABC Company" } — NEVER invent database ids.
- For assignees use { "by": "name", "query": "Rahul" }.
- For money use numbers (5 lakh = 500000). For relative dates use { "relative": "tomorrow", "time": "10:00" } or { "days": 15 }.
- Understand mixed Telugu+English (create cheyyi, assign chesi, repu, chupinchu, update cheyyi).
- Never invent amounts, GST%, due dates, or assignees if not stated. If required fields missing, set "ask" and empty steps.
- Unsupported (payroll, employee salary, HR): ask.type=unsupported.
- Multi-step allowed (max 8). Use saveAs on create steps and { "from": "lead" } later.
- Deal has NO assignedTo field — assign contacts instead.
- GST/taxRate only if user stated a rate; otherwise omit or 0 (never invent GST).
- For string fields (name, company, phone, title, description, status, clientName) use plain strings, NOT soft-ref objects.
- Soft-ref objects are ONLY for contact/deal/assignee/product/invoice/meeting keys.
- CRITICAL: Whenever the user names an EXISTING company/person to act on, ALWAYS set args.contact = { "by": "company_or_name", "query": "<exact company or person as stated>" }. Do not put the target only in company/clientName/description. Keep the full company string (do not truncate).
- create_lead uses plain strings: name, company, phone, status — plus assignee soft-ref. Do NOT use contact soft-ref for create_lead.
- create_invoice MUST include contact soft-ref (and amount, description, due/dueInDays). Example: contact:{by:"company_or_name",query:"ABC Company"}, amount:85000, description:"website development", due:{days:15}. Do not invent taxRate/GST.
- update_contact / assign_contact MUST include contact soft-ref for the target company, plus status/assignee as needed.
- For due dates use args.due as { "relative":"tomorrow","time":"10:00" } or { "days": 15 } — do not put objects in dueDate string field.
- Deletes: ALWAYS emit action delete_contact / delete_deal / delete_task (risk handled by server confirmation). Do NOT ask "are you sure" in ask — server will require confirmToken.

JSON shape:
{
  "intent": "string",
  "language": "en|te|mixed",
  "steps": [{ "id": "s1", "action": "create_lead", "args": {}, "saveAs": "lead" }],
  "ask": null | { "type": "missing_fields"|"choice"|"unsupported", "message": "...", "missingFields": [] }
}`;

  const hist = history
    .slice(-6)
    .map((h) => `${h.role}: ${sanitizePromptInput(h.content)}`)
    .join("\n");

  const userPrompt = `Workspace members (names only): ${memberHint}
Money hints seen: ${hints.amounts.join(", ") || "none"}
Due hints: ${hints.dueHints.join(", ") || "none"}

Recent conversation:
${hist || "(none)"}

User command:
${sanitizePromptInput(message)}

Respond with JSON action plan.`;

  const ai = await getAIService();
  try {
    const res = await ai.generateJSON<ActionPlan>(userPrompt, {
      systemPrompt: system,
      temperature: 0.2,
      maxTokens: 1800,
    });
    const plan = res.data;
    if (!plan || typeof plan !== "object") {
      return {
        intent: "parse_error",
        steps: [],
        ask: { type: "missing_fields", message: "I couldn't understand that. Please rephrase.", missingFields: [] },
      };
    }
    if (!Array.isArray(plan.steps)) plan.steps = [];
    plan.steps = plan.steps.slice(0, 8).map((s, idx) => ({
      id: s.id || `s${idx + 1}`,
      action: String(s.action || ""),
      args: (s.args && typeof s.args === "object" ? s.args : {}) as Record<string, unknown>,
      saveAs: s.saveAs,
    }));
    return plan;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI planning failed";
    return {
      intent: "error",
      steps: [],
      ask: { type: "missing_fields", message: msg, missingFields: [] },
    };
  }
}
