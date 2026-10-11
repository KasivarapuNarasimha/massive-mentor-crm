import { Prisma } from "@prisma/client";
import { CommercialValueError, parseCommercialDecimal } from "../lib/commercial-money.js";

// Keep multiplication precision local: 18-digit operands can exceed the global default.
// Never alter Prisma.Decimal's global settings used by legacy Finance/SaaS callers.
const ExactDecimal = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });

export type CommercialLineInput = { quantity: unknown; unitPrice: unknown; taxRate: unknown };

/** Base ERP-compatible math only; discount/GST policy needs later approval. */
export function calculateCommercialLine(input: CommercialLineInput) {
  const quantity = parseCommercialDecimal(input.quantity, "quantity");
  if (quantity.lte(0)) throw new CommercialValueError("quantity", "must be greater than zero");
  const unitPrice = parseCommercialDecimal(input.unitPrice, "money", "unitPrice");
  const taxRate = parseCommercialDecimal(input.taxRate, "taxRate");
  const amount = parseCommercialDecimal(
    new ExactDecimal(quantity).mul(unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2), "money", "lineAmount"
  );
  const taxAmount = parseCommercialDecimal(
    new ExactDecimal(amount).mul(taxRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2), "money", "lineTax"
  );
  const total = parseCommercialDecimal(amount.add(taxAmount).toFixed(2), "money", "lineTotal");
  return { quantity, unitPrice, taxRate, amount, taxAmount, total };
}

export function calculateCommercialTotals(items: readonly CommercialLineInput[]) {
  if (!items.length) throw new CommercialValueError("items", "at least one line required");
  const lines = items.map(calculateCommercialLine);
  let subtotal = new Prisma.Decimal(0);
  let taxAmount = new Prisma.Decimal(0);
  for (const line of lines) { subtotal = subtotal.add(line.amount); taxAmount = taxAmount.add(line.taxAmount); }
  return {
    lines,
    subtotal: parseCommercialDecimal(subtotal.toFixed(2), "money", "subtotal"),
    taxAmount: parseCommercialDecimal(taxAmount.toFixed(2), "money", "taxAmount"),
    total: parseCommercialDecimal(subtotal.add(taxAmount).toFixed(2), "money", "grandTotal"),
  };
}

export const COMMERCIAL_PRICING_VERSION = "stacked-exclusive-v1";
type DiscountInput = { percentage?: unknown; fixedAmount?: unknown };
export type CommercialQuoteLineInput = CommercialLineInput & {
  /** Immutable, unique nonnegative integer identity; not the current display order. */
  position: string;
  discount?: DiscountInput;
};
export type CommercialQuotePricingInput = {
  currency: string;
  items: readonly CommercialQuoteLineInput[];
  discount?: DiscountInput;
};

/** Opt-in arithmetic only. No database, approval thresholds or role decisions.
 * Currency configuration is supplied by trusted application policy, never inferred.
 */
export function calculateCommercialQuote(
  input: CommercialQuotePricingInput,
  currencies: readonly { code: string; decimalPlaces: number }[]
) {
  const fail = (field: string, reason: string): never => { throw new CommercialValueError(field, reason); };
  if (!input || !Array.isArray(currencies) || !currencies.length ||
      currencies.some(c => !c || !/^[A-Z]{3}$/.test(c.code) || c.decimalPlaces !== 2) ||
      new Set(currencies.map(c => c.code)).size !== currencies.length ||
      !currencies.some(c => c.code === input.currency)) fail("currency", "explicit two-decimal currency configuration required");
  if (!Array.isArray(input.items) || !input.items.length) fail("items", "at least one line required");
  const money = (value: unknown, field: string) => new ExactDecimal(parseCommercialDecimal(value, "money", field));
  const rounded = (value: InstanceType<typeof ExactDecimal>, field: string) =>
    money(value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2), field);
  const discount = (value: DiscountInput | undefined, field: string) => {
    if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).some(key => key !== "percentage" && key !== "fixedAmount"))) fail(field, "invalid discount object");
    const percentage = new ExactDecimal(parseCommercialDecimal(value?.percentage === undefined ? "0" : value.percentage, "taxRate", `${field}.percentage`));
    if (percentage.gt(100)) fail(field, "percentage exceeds 100");
    return { percentage, fixed: money(value?.fixedAmount === undefined ? "0" : value.fixedAmount, `${field}.fixedAmount`) };
  };
  // Integer cents make quotient/remainder comparisons exact, including tied remainders.
  const cents = (value: InstanceType<typeof ExactDecimal>) => BigInt(value.mul(100).toFixed(0));
  const fromCents = (value: bigint) => new ExactDecimal(value.toString()).div(100);
  const seen = new Set<string>();
  const lines = input.items.map((item, index) => {
    if (!item || typeof item.position !== "string" || !/^(0|[1-9]\d*)$/.test(item.position) ||
        item.position.length > 32 || seen.has(item.position)) fail("position", "unique immutable integer position required");
    seen.add(item.position);
    const quantity = new ExactDecimal(parseCommercialDecimal(item.quantity, "quantity"));
    if (quantity.lte(0)) fail("quantity", "must be greater than zero");
    const unitPrice = money(item.unitPrice, "unitPrice");
    const taxRate = new ExactDecimal(parseCommercialDecimal(item.taxRate, "taxRate"));
    const original = rounded(quantity.mul(unitPrice), "lineSubtotal");
    const d = discount(item.discount, `items[${index}].discount`);
    const percentageDiscount = rounded(original.mul(d.percentage).div(100), "linePercentageDiscount");
    const remaining = original.sub(percentageDiscount);
    if (d.fixed.gt(remaining)) fail("lineFixedDiscount", "exceeds remaining line base");
    return { position: item.position, quantity, unitPrice, taxRate, original, percentageDiscount,
      fixedDiscount: d.fixed, base: remaining.sub(d.fixed) };
  });
  const sum = (values: InstanceType<typeof ExactDecimal>[]) => values.reduce((a, b) => a.add(b), new ExactDecimal(0));
  const originalSubtotal = rounded(sum(lines.map(l => l.original)), "originalSubtotal");
  const afterLines = rounded(sum(lines.map(l => l.base)), "afterLineDiscounts");
  const quoteDiscount = discount(input.discount, "discount");
  const quotePercentage = rounded(afterLines.mul(quoteDiscount.percentage).div(100), "quotePercentageDiscount");
  /** Allocate a rounded quotation discount against the current remaining bases. */
  const allocate = (amount: InstanceType<typeof ExactDecimal>, bases: InstanceType<typeof ExactDecimal>[]) => {
    const target = cents(amount), weights = bases.map(cents), total = weights.reduce((a, b) => a + b, 0n);
    if (target > total) fail("quoteDiscount", "exceeds remaining quotation base");
    if (!target) return bases.map(() => new ExactDecimal(0));
    const rows = weights.map((weight, index) => ({ index, value: target * weight / total,
      remainder: target * weight % total, position: BigInt(lines[index].position) }));
    let extra = target - rows.reduce((a, row) => a + row.value, 0n);
    const ranked = [...rows].sort((a, b) => a.remainder === b.remainder
      ? (a.position < b.position ? -1 : a.position > b.position ? 1 : 0)
      : a.remainder > b.remainder ? -1 : 1);
    for (const row of ranked) { if (!extra) break; row.value += 1n; extra -= 1n; }
    return rows.map(row => fromCents(row.value));
  };
  const percentageAllocations = allocate(quotePercentage, lines.map(l => l.base));
  const afterPercentage = lines.map((l, i) => l.base.sub(percentageAllocations[i]));
  const fixedAllocations = allocate(quoteDiscount.fixed, afterPercentage);
  const resultLines = lines.map((line, i) => {
    const taxable = afterPercentage[i].sub(fixedAllocations[i]);
    const tax = rounded(taxable.mul(line.taxRate).div(100), "lineTax");
    const total = rounded(taxable.add(tax), "lineTotal");
    return { position: line.position, quantity: line.quantity.toFixed(4), unitPrice: line.unitPrice.toFixed(2),
      taxRate: line.taxRate.toFixed(4), originalSubtotal: line.original.toFixed(2),
      linePercentageDiscount: line.percentageDiscount.toFixed(2), lineFixedDiscount: line.fixedDiscount.toFixed(2),
      quotePercentageAllocation: percentageAllocations[i].toFixed(2), quoteFixedAllocation: fixedAllocations[i].toFixed(2),
      taxableBase: taxable.toFixed(2), tax: tax.toFixed(2), grandTotal: total.toFixed(2) };
  });
  const taxableBase = rounded(sum(resultLines.map(l => new ExactDecimal(l.taxableBase))), "taxableBase");
  const tax = rounded(sum(resultLines.map(l => new ExactDecimal(l.tax))), "tax");
  const totalDiscount = originalSubtotal.sub(taxableBase);
  return { calculationPolicyVersion: COMMERCIAL_PRICING_VERSION, currency: input.currency, lines: resultLines,
    originalSubtotal: originalSubtotal.toFixed(2),
    linePercentageDiscount: sum(lines.map(l => l.percentageDiscount)).toFixed(2),
    lineFixedDiscount: sum(lines.map(l => l.fixedDiscount)).toFixed(2),
    quotePercentageDiscount: quotePercentage.toFixed(2), quoteFixedDiscount: quoteDiscount.fixed.toFixed(2),
    totalDiscount: totalDiscount.toFixed(2), taxableBase: taxableBase.toFixed(2), tax: tax.toFixed(2),
    grandTotal: rounded(taxableBase.add(tax), "grandTotal").toFixed(2),
    // Display only: threshold comparisons must use the exact ratio below.
    effectiveDiscountPercentage: originalSubtotal.isZero() ? null : totalDiscount.mul(100).div(originalSubtotal).toFixed(4),
    effectiveDiscountRatio: originalSubtotal.isZero() ? null : {
      numerator: cents(totalDiscount).toString(), denominator: cents(originalSubtotal).toString(),
    },
  };
}
