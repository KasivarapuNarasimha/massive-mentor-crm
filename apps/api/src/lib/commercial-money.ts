import { Prisma } from "@prisma/client";

export type CommercialDecimalKind = "money" | "quantity" | "taxRate";
// Storage limits, not tax policy. Legacy permissive helpers are unchanged.
const FORMATS = {
  money: { precision: 18, scale: 2 },
  quantity: { precision: 18, scale: 4 },
  taxRate: { precision: 8, scale: 4 },
} as const;

export class CommercialValueError extends Error {
  readonly code = "INVALID_COMMERCIAL_VALUE";
  constructor(readonly field: string, reason: string) {
    super(`${field}: ${reason}`);
    this.name = "CommercialValueError";
  }
}

/** Opt-in: no currency stripping, coercion, silent zero or precision rounding. */
export function parseCommercialDecimal(
  input: unknown, kind: CommercialDecimalKind, field: string = kind
): Prisma.Decimal {
  const { precision, scale } = FORMATS[kind];
  const fail = (reason: string): never => { throw new CommercialValueError(field, reason); };
  // JSON numbers may already have lost digits before this function runs.
  if (typeof input !== "string" || input.length > 64 ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input)) {
    return fail("canonical decimal string required");
  }
  const value = new Prisma.Decimal(input);
  if (!value.isFinite()) return fail("finite decimal required");
  if (value.lt(0)) return fail("negative value not allowed");
  if (value.decimalPlaces() > scale) return fail(`at most ${scale} decimal places required`);
  const max = new Prisma.Decimal(10).pow(precision - scale).sub(new Prisma.Decimal(10).pow(-scale));
  if (value.gt(max)) return fail(`exceeds Decimal(${precision},${scale}) storage limit`);
  return value;
}
