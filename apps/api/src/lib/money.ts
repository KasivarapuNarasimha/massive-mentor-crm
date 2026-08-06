/**
 * Safe money helpers for Prisma Decimal fields.
 * Store/compute as Decimal; expose numbers to JSON APIs via toMoneyNumber.
 */
import { Prisma } from "@prisma/client";

export type MoneyInput = number | string | Prisma.Decimal | null | undefined;

function isDecimal(value: unknown): value is Prisma.Decimal {
  return (
    value instanceof Prisma.Decimal ||
    (!!value &&
      typeof value === "object" &&
      typeof (value as { toNumber?: unknown }).toNumber === "function" &&
      typeof (value as { toFixed?: unknown }).toFixed === "function")
  );
}

/** Convert any money input (incl. raw SQL unknown) to Prisma.Decimal (2 d.p.). */
export function toDecimal(value: MoneyInput | unknown, scale = 2): Prisma.Decimal {
  if (value == null || value === "") return new Prisma.Decimal(0);
  if (isDecimal(value)) {
    try {
      return new Prisma.Decimal(value.toString()).toDecimalPlaces(scale);
    } catch {
      return new Prisma.Decimal(0);
    }
  }
  if (typeof value === "bigint") {
    return new Prisma.Decimal(value.toString()).toDecimalPlaces(scale);
  }
  const n =
    typeof value === "number"
      ? value
      : Number(
          String(value)
            .replace(/[₹$€£\s]/g, "")
            .replace(/,/g, "")
            .trim()
        );
  if (!Number.isFinite(n)) return new Prisma.Decimal(0);
  return new Prisma.Decimal(n).toDecimalPlaces(scale);
}

/** Serialize for JSON / frontend (number, 2 d.p.). Accepts raw SQL unknown. */
export function toMoneyNumber(value: MoneyInput | unknown): number {
  return toDecimal(value).toNumber();
}

/** Add money values as Decimal then return number for API. */
export function moneySum(values: MoneyInput[]): number {
  let s = new Prisma.Decimal(0);
  for (const v of values) s = s.add(toDecimal(v));
  return s.toDecimalPlaces(2).toNumber();
}

export function moneyAdd(a: MoneyInput, b: MoneyInput): Prisma.Decimal {
  return toDecimal(a).add(toDecimal(b)).toDecimalPlaces(2);
}

export function moneySub(a: MoneyInput, b: MoneyInput): Prisma.Decimal {
  return toDecimal(a).sub(toDecimal(b)).toDecimalPlaces(2);
}

export function moneyMul(a: MoneyInput, b: MoneyInput, scale = 2): Prisma.Decimal {
  return toDecimal(a).mul(toDecimal(b, 6)).toDecimalPlaces(scale);
}

/** Compare money: a >= b */
export function moneyGte(a: MoneyInput, b: MoneyInput): boolean {
  return toDecimal(a).gte(toDecimal(b));
}
