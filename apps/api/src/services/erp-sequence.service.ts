/**
 * Simple per-business document numbers for ERP (PO / GRN / PR).
 * Additive — does not touch finance InvoiceSequence keys unless needed.
 */
import { prisma } from "../lib/prisma.js";

export async function nextErpDocumentNumber(
  businessId: string,
  kind: "PO" | "GRN" | "PR" | "SO"
): Promise<string> {
  if (!businessId) {
    throw new Error("Business workspace is required for document numbers");
  }
  const year = new Date().getFullYear();
  const key = `erp:${kind}:${businessId}:${year}`;
  const prefix = `${kind}-${year}-`;

  const row = await prisma.invoiceSequence.upsert({
    where: { key },
    create: {
      key,
      prefix,
      lastValue: 1,
      businessId,
    },
    update: { lastValue: { increment: 1 } },
  });

  const n = row.lastValue;
  return `${prefix}${String(n).padStart(6, "0")}`;
}
