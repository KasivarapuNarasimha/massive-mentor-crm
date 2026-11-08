/**
 * Compare a captured Razorpay amount, in paise, with the amount we stored
 * for that order. Callers must do this before activation.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Paise sent to Razorpay. The gateway minimum is 100 paise. */
export function orderAmountPaise(totalInr: number): number {
  const paise = Math.round(totalInr * 100);
  return Math.max(100, paise);
}

/**
 * Prefer the paise persisted when the order was created.
 * Older rows fall back to the stored rupee total.
 */
export function expectedAmountPaise(amountInr: number, metadata: unknown): number {
  const stored = asRecord(metadata)?.expectedAmountPaise;
  if (typeof stored === "number" && Number.isInteger(stored) && stored >= 0) return stored;
  if (!Number.isFinite(amountInr)) return Number.NaN;
  const rupees = Math.round(amountInr * 100) / 100;
  return Math.round(rupees * 100);
}

/** Razorpay payment and order entities report amount as integer paise. */
export function readCapturedPaise(entity: unknown): number | null {
  const amount = asRecord(entity)?.amount;
  if (typeof amount === "number" && Number.isInteger(amount) && amount >= 0) return amount;
  if (typeof amount === "string" && /^\d+$/.test(amount)) return Number(amount);
  return null;
}

export type AmountComparison = "match" | "underpayment" | "overpayment" | "invalid";

export function compareCapturedAmount(
  expectedPaise: number,
  capturedPaise: number | null
): AmountComparison {
  if (capturedPaise == null || !Number.isInteger(expectedPaise) || expectedPaise < 0) {
    return "invalid";
  }
  if (capturedPaise === expectedPaise) return "match";
  if (capturedPaise < expectedPaise) return "underpayment";
  return "overpayment";
}

export type CaptureDecision = {
  activate: boolean;
  duplicate: boolean;
  reason:
    | "match"
    | "underpayment"
    | "overpayment"
    | "invalid"
    | "already_processed"
    | "already_activated";
};

/**
 * A processed event or an already activated payment never activates again.
 * Any other amount mismatch is rejected before activation.
 */
export function decideCapturedActivation(input: {
  eventAlreadyProcessed: boolean;
  paymentFound: boolean;
  paymentStatus?: string;
  activated?: boolean;
  comparison?: AmountComparison;
}): CaptureDecision {
  if (input.eventAlreadyProcessed) {
    return { activate: false, duplicate: true, reason: "already_processed" };
  }
  if (!input.paymentFound) {
    return { activate: false, duplicate: false, reason: "invalid" };
  }
  if (input.paymentStatus === "paid" && input.activated) {
    return { activate: false, duplicate: true, reason: "already_activated" };
  }
  const comparison = input.comparison ?? "invalid";
  if (comparison !== "match") {
    return { activate: false, duplicate: false, reason: comparison };
  }
  return { activate: true, duplicate: false, reason: "match" };
}
