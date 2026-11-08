/**
 * New SaaS rate card. This module does not read or write subscriptions,
 * invoices, payments, or plan rows. Callers persist a quote only on a new
 * checkout payment. Renewals of a pre-2026 contract use the stored base.
 */
export const SAAS_PRICING_VERSION = "2026-per-user" as const;
export const GST_RATE = 0.18;
export const SETUP_FEE_INR = 30_000;
export const ANNUAL_MONTHS = 12;
export const MIN_USERS = 1;
export const MAX_USERS = 500;

export const PER_USER_MONTHLY_INR = {
  starter: 300,
  professional: 600,
} as const;

/**
 * Flat prices sold before per-user pricing. Existing subscriptions renew at
 * these amounts. New checkouts must not use them.
 */
export const LEGACY_PLAN_PRICE_INR: Record<string, number> = {
  starter_monthly: 1499,
  starter_annual: 16189,
  professional_monthly: 6999,
  professional_annual: 75589,
  enterprise_monthly: 0,
  enterprise_annual: 0,
};

export type SaasTier = "starter" | "professional" | "enterprise";
export type SaasCycle = "monthly" | "annual";
export type SaasCheckoutPurpose = "checkout" | "upgrade" | "downgrade" | "renewal" | "retry";

export type PaidContract = {
  pricingVersion?: string | null;
  planCode?: string | null;
  basePrice?: number | null;
  subscriptionBase?: number | null;
  userCount?: number | null;
};

export type InvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type PriceQuote = {
  pricingVersion: typeof SAAS_PRICING_VERSION | "legacy";
  planCode: string;
  tier: SaasTier;
  billingCycle: SaasCycle;
  userCount: number;
  unitPrice: number;
  subscriptionBase: number;
  setupFee: number;
  discountAmount: number;
  prorationCredit: number;
  taxable: number;
  gst: number;
  total: number;
  lines: InvoiceLine[];
};

export function roundInr(value: number): number {
  return Math.round(value * 100) / 100;
}

export function defaultUserCount(tier: "starter" | "professional"): number {
  return tier === "professional" ? 10 : 3;
}

export function parsePlanCode(code: string): { tier: SaasTier; billingCycle: SaasCycle } | null {
  const match = /^(starter|professional|enterprise)_(monthly|annual)$/.exec(code);
  if (!match) return null;
  return { tier: match[1] as SaasTier, billingCycle: match[2] as SaasCycle };
}

export function perUserUnit(tier: "starter" | "professional", cycle: SaasCycle): number {
  const monthly = PER_USER_MONTHLY_INR[tier];
  return cycle === "annual" ? monthly * ANNUAL_MONTHS : monthly;
}

export function publicRateCard() {
  return {
    version: SAAS_PRICING_VERSION,
    gstRate: GST_RATE,
    setupFee: SETUP_FEE_INR,
    annualMonths: ANNUAL_MONTHS,
    annualDiscountPct: 0,
    perUserMonthly: { ...PER_USER_MONTHLY_INR },
    perUserAnnual: {
      starter: perUserUnit("starter", "annual"),
      professional: perUserUnit("professional", "annual"),
    },
    defaultUsers: { starter: defaultUserCount("starter"), professional: defaultUserCount("professional") },
  };
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function assertUserCount(value: number): number {
  if (!Number.isInteger(value) || value < MIN_USERS || value > MAX_USERS) {
    throw new Error(`User count must be a whole number from ${MIN_USERS} to ${MAX_USERS}`);
  }
  return value;
}

function legacyRenewalBase(planCode: string, contract: PaidContract | null): number {
  const fromContract = finiteNumber(contract?.basePrice) ?? finiteNumber(contract?.subscriptionBase);
  if (fromContract != null) return roundInr(fromContract);
  const catalog = LEGACY_PLAN_PRICE_INR[planCode];
  if (catalog == null) throw new Error("No contracted price for renewal");
  return catalog;
}

function applyTax(input: {
  subscriptionBase: number;
  setupFee: number;
  discountAmount: number;
  prorationCredit: number;
}): Pick<PriceQuote, "discountAmount" | "prorationCredit" | "taxable" | "gst" | "total"> {
  const prorationCredit = roundInr(
    Math.min(Math.max(0, input.prorationCredit), input.subscriptionBase * 0.9)
  );
  const discountRoom = Math.max(0, input.subscriptionBase - prorationCredit);
  const discountAmount = roundInr(Math.min(Math.max(0, input.discountAmount), discountRoom));
  const taxable = roundInr(
    Math.max(0, input.subscriptionBase - discountAmount - prorationCredit) + input.setupFee
  );
  const gst = roundInr(taxable * GST_RATE);
  const total = roundInr(taxable + gst);
  return { discountAmount, prorationCredit, taxable, gst, total };
}

/**
 * Quote a charge without touching stored subscriptions or invoices.
 * Renewal never adds the setup fee. A legacy renewal uses the stored base,
 * not the current per-user rate.
 */
export function quoteSaasCharge(input: {
  planCode: string;
  purpose: SaasCheckoutPurpose;
  userCount?: number;
  setupFeePaid: boolean;
  paidContract?: PaidContract | null;
  /** True only when this business already has a paid plan. Blocks a fake renewal. */
  existingPaidSubscription?: boolean;
  discountAmount?: number;
  prorationCredit?: number;
}): PriceQuote {
  const parsed = parsePlanCode(input.planCode);
  if (!parsed) throw new Error("Invalid plan");
  if (parsed.tier === "enterprise") {
    throw new Error("Enterprise pricing is custom. Contact sales.");
  }

  const contract = input.paidContract ?? null;
  const perUserContract = contract?.pricingVersion === SAAS_PRICING_VERSION;
  let pricingVersion: PriceQuote["pricingVersion"] = SAAS_PRICING_VERSION;
  let userCount: number;
  let unitPrice: number;
  let subscriptionBase: number;
  let setupFee = 0;

  if (input.purpose === "renewal") {
    const hasStoredBase =
      perUserContract ||
      finiteNumber(contract?.basePrice) != null ||
      finiteNumber(contract?.subscriptionBase) != null;
    if (!hasStoredBase && !input.existingPaidSubscription) {
      throw new Error("Renewal requires an existing subscription");
    }
    if (perUserContract) {
      userCount = assertUserCount(
        contract?.userCount ?? input.userCount ?? defaultUserCount(parsed.tier)
      );
      unitPrice = perUserUnit(parsed.tier, parsed.billingCycle);
      subscriptionBase = roundInr(userCount * unitPrice);
    } else {
      subscriptionBase = legacyRenewalBase(input.planCode, contract);
      userCount = 1;
      unitPrice = subscriptionBase;
      pricingVersion = "legacy";
    }
  } else {
    userCount = assertUserCount(input.userCount ?? defaultUserCount(parsed.tier));
    unitPrice = perUserUnit(parsed.tier, parsed.billingCycle);
    subscriptionBase = roundInr(userCount * unitPrice);
    if (!input.setupFeePaid) setupFee = SETUP_FEE_INR;
  }

  const tax = applyTax({
    subscriptionBase,
    setupFee,
    discountAmount: input.discountAmount ?? 0,
    prorationCredit: input.prorationCredit ?? 0,
  });

  const tierLabel = parsed.tier === "starter" ? "Starter" : "Professional";
  const cycleLabel = parsed.billingCycle === "annual" ? "annual" : "monthly";
  const lines: InvoiceLine[] =
    pricingVersion === "legacy"
      ? [
          {
            description: `${tierLabel} ${cycleLabel} subscription (existing price)`,
            quantity: 1,
            unitPrice: subscriptionBase,
            amount: subscriptionBase,
          },
        ]
      : [
          {
            description: `${tierLabel} ${cycleLabel} subscription`,
            quantity: userCount,
            unitPrice,
            amount: subscriptionBase,
          },
        ];
  if (setupFee > 0) {
    lines.push({
      description: "One-time setup, onboarding and technical training",
      quantity: 1,
      unitPrice: setupFee,
      amount: setupFee,
    });
  }

  return {
    pricingVersion,
    planCode: input.planCode,
    tier: parsed.tier,
    billingCycle: parsed.billingCycle,
    userCount,
    unitPrice,
    subscriptionBase,
    setupFee,
    lines,
    ...tax,
  };
}

export function invoiceLinesFromMetadata(
  metadata: unknown,
  fallback: { description: string; amount: number }
): InvoiceLine[] {
  if (!metadata || typeof metadata !== "object") {
    return [{ description: fallback.description, quantity: 1, unitPrice: fallback.amount, amount: fallback.amount }];
  }
  const lines = (metadata as { lines?: unknown }).lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    return [{ description: fallback.description, quantity: 1, unitPrice: fallback.amount, amount: fallback.amount }];
  }
  const parsed: InvoiceLine[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const row = line as { description?: unknown; quantity?: unknown; unitPrice?: unknown; amount?: unknown };
    const amount = finiteNumber(row.amount);
    const quantity = finiteNumber(row.quantity);
    const unitPrice = finiteNumber(row.unitPrice);
    if (amount == null || quantity == null || unitPrice == null) continue;
    parsed.push({
      description: typeof row.description === "string" && row.description.trim() ? row.description : fallback.description,
      quantity,
      unitPrice,
      amount,
    });
  }
  return parsed.length > 0
    ? parsed
    : [{ description: fallback.description, quantity: 1, unitPrice: fallback.amount, amount: fallback.amount }];
}

/** Monthly recurring amount for a subscription. Legacy rows keep plan.price. */
export function monthlyRecurringAmount(input: {
  billingCycle: string | null | undefined;
  planPrice: number;
  metadata: unknown;
}): number {
  const meta = input.metadata && typeof input.metadata === "object" ? (input.metadata as Record<string, unknown>) : null;
  const version = meta?.pricingVersion;
  const subscriptionBase = finiteNumber(meta?.subscriptionBase);
  if (version === SAAS_PRICING_VERSION && subscriptionBase != null) {
    return input.billingCycle === "annual" ? roundInr(subscriptionBase / 12) : subscriptionBase;
  }
  const price = input.planPrice;
  return input.billingCycle === "annual" ? roundInr(price / 12) : price;
}

export function paidContractFromMetadata(metadata: unknown): PaidContract | null {
  if (!metadata || typeof metadata !== "object") return null;
  const meta = metadata as Record<string, unknown>;
  return {
    pricingVersion: typeof meta.pricingVersion === "string" ? meta.pricingVersion : null,
    planCode: typeof meta.planCode === "string" ? meta.planCode : null,
    basePrice: finiteNumber(meta.basePrice),
    subscriptionBase: finiteNumber(meta.subscriptionBase),
    userCount: finiteNumber(meta.userCount),
  };
}

export function contractFromPaidMetadata(metadata: unknown, planCode: string | null) {
  const meta = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  if (meta.pricingVersion === SAAS_PRICING_VERSION) {
    return {
      pricingVersion: SAAS_PRICING_VERSION,
      renewalBase: finiteNumber(meta.subscriptionBase),
      userCount: finiteNumber(meta.userCount),
      planCode: typeof meta.planCode === "string" ? meta.planCode : planCode,
    };
  }
  const base = finiteNumber(meta.basePrice) ?? (planCode ? LEGACY_PLAN_PRICE_INR[planCode] ?? null : null);
  return {
    pricingVersion: "legacy" as const,
    renewalBase: base,
    userCount: null,
    planCode: typeof meta.planCode === "string" ? meta.planCode : planCode,
  };
}
