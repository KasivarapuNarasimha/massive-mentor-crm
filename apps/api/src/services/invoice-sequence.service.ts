/**
 * Atomic, globally unique invoice / platform invoice number generation.
 * Uses Postgres advisory locks + InvoiceSequence row upsert.
 */
import { prisma } from "@/lib/prisma";

/**
 * Next number for tenant finance invoices: INV-YYYY-00001 (unique per business).
 */
export async function nextFinanceInvoiceNumber(businessId: string): Promise<string> {
  const year = new Date().getFullYear();
  const key = `finance:${businessId}:${year}`;

  const seq = await prisma.$transaction(async (tx) => {
    // Serialize concurrent generators for this key
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1::text))`,
      key
    );
    const existing = await tx.invoiceSequence.findUnique({ where: { key } });
    if (existing) {
      return tx.invoiceSequence.update({
        where: { key },
        data: { lastValue: { increment: 1 } },
      });
    }
    return tx.invoiceSequence.create({
      data: { key, lastValue: 1, prefix: `INV-${year}-`, businessId },
    });
  });

  return `${seq.prefix}${String(seq.lastValue).padStart(5, "0")}`;
}

/**
 * Globally unique SaaS billing invoice: MM-INV-YYYY-000001
 */
export async function nextSaaSInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const key = `saas:global:${year}`;

  const seq = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1::text))`,
      key
    );
    const existing = await tx.invoiceSequence.findUnique({ where: { key } });
    if (existing) {
      return tx.invoiceSequence.update({
        where: { key },
        data: { lastValue: { increment: 1 } },
      });
    }
    return tx.invoiceSequence.create({
      data: { key, lastValue: 1, prefix: `MM-INV-${year}-` },
    });
  });

  return `${seq.prefix}${String(seq.lastValue).padStart(6, "0")}`;
}

/**
 * Platform invoice numbers (Super Admin): PLT-INV-YYYY-000001
 */
export async function nextPlatformInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const key = `platform:global:${year}`;

  const seq = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1::text))`,
      key
    );
    const existing = await tx.invoiceSequence.findUnique({ where: { key } });
    if (existing) {
      return tx.invoiceSequence.update({
        where: { key },
        data: { lastValue: { increment: 1 } },
      });
    }
    return tx.invoiceSequence.create({
      data: { key, lastValue: 1, prefix: `PLT-INV-${year}-` },
    });
  });

  return `${seq.prefix}${String(seq.lastValue).padStart(6, "0")}`;
}
