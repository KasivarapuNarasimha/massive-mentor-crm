/**
 * User-facing message helpers — polish only.
 * Maps technical API/network errors to friendly copy without changing API contracts.
 */

const TECHNICAL =
  /internal server error|econnrefused|prisma|sql|stack|undefined is not|cannot read|jwt|token expired|unauthorized|forbidden|status code 5\d\d|500|502|503|504|networkerror|failed to fetch/i;

function scrubAiProviderNames(raw: string): string {
  return raw
    .replace(/\bgroq\b/gi, "Massive Mentor AI")
    .replace(/\bopenai\b/gi, "Massive Mentor AI")
    .replace(/\bgpt-oss[-\w]*/gi, "AI")
    .replace(/\btpd\b/gi, "daily limit")
    .replace(/rate_limit_exceeded/gi, "usage limit reached")
    .replace(/GROQ_API_KEY|GROQ_MODEL|AI_PROVIDER/gi, "AI configuration");
}

/** Prefer a calm, actionable message for end users. */
export function friendlyError(
  error: string | null | undefined,
  fallback = "Something went wrong. Please try again or contact your administrator."
): string {
  const raw = scrubAiProviderNames((error || "").trim());
  if (!raw) return fallback;

  if (/massive mentor ai usage limit reached/i.test(raw)) {
    return raw;
  }
  if (/rate limit|429|daily ai|usage limit reached/i.test(raw)) {
    return [
      "Massive Mentor AI usage limit reached",
      "Please try again after the daily limit resets.",
    ].join("\n");
  }

  // Already friendly short product messages
  if (
    /required|invalid|not found|permission|access|denied|offline|timed out|duplicate|select at least|try again|massive mentor ai/i.test(
      raw
    ) &&
    !TECHNICAL.test(raw) &&
    raw.length < 280
  ) {
    return raw;
  }

  if (/not authenticated|unauthorized|401/i.test(raw)) {
    return "Your session has expired. Please sign in again.";
  }
  if (/permission|forbidden|403|insufficient/i.test(raw)) {
    return "You don't have permission to do that. Contact your administrator if you need access.";
  }
  if (/not found|404/i.test(raw)) {
    return "We couldn't find that item. It may have been moved or deleted.";
  }
  if (/timed out|timeout|aborted/i.test(raw)) {
    return "The request took too long. Please try again.";
  }
  if (/offline|failed to fetch|network|cannot reach/i.test(raw)) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  if (TECHNICAL.test(raw) || raw.length > 280) {
    return fallback;
  }
  return raw;
}

/** Standardized success copy */
export const SuccessMsg = {
  leadCreated: "Lead created successfully",
  leadUpdated: "Lead updated successfully",
  leadDeleted: "Lead deleted successfully",
  clientCreated: "Client created successfully",
  clientUpdated: "Client updated successfully",
  dealCreated: "Deal created successfully",
  dealUpdated: "Deal updated successfully",
  dealDeleted: "Deal deleted successfully",
  taskCreated: "Task created successfully",
  taskUpdated: "Task updated successfully",
  taskDeleted: "Task deleted successfully",
  meetingCreated: "Meeting scheduled successfully",
  meetingUpdated: "Meeting updated successfully",
  meetingDeleted: "Meeting deleted successfully",
  mediaUploaded: "Media uploaded successfully",
  mediaDeleted: "Media deleted successfully",
  whatsappSent: "WhatsApp message sent successfully",
  saved: "Saved successfully",
  assigned: "Assigned successfully",
} as const;
