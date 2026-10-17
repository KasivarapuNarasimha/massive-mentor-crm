import PDFDocument from "pdfkit";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { parseCommercialDecimal } from "../lib/commercial-money.js";
import { CommercialDocumentError } from "./commercial-document.service.js";
import { calculateCommercialQuote, type CommercialQuotePricingInput } from "./commercial-pricing.service.js";

type SealedPdfSource = {
  envelope: {
    quotationNumber: unknown;
    revisionNumber: unknown;
    currency: unknown;
    validUntil: unknown;
    terms: unknown;
    customerSnapshot: unknown;
    items: unknown;
  };
  output: {
    totalDiscount: unknown;
    taxableBase: unknown;
    tax: unknown;
    grandTotal: unknown;
  };
};

/** Safe download name for a business quotation number. Never accepts a token or path. */
export function quotationPdfFilename(number: string): string {
  if (!/^QT-\d{4}-\d{5}$/.test(number)) throw new CommercialDocumentError("QUOTATION_NUMBER_INVALID", 409);
  return `${number}.pdf`;
}

/** Copies only the fields the renderer is allowed to see. Validation stays in the renderer. */
export function quotationPdfSource(verified: {
  envelope: Record<string, unknown>;
  output: { totalDiscount: unknown; taxableBase: unknown; tax: unknown; grandTotal: unknown };
}): SealedPdfSource {
  const envelope = verified.envelope;
  return {
    envelope: {
      quotationNumber: envelope.quotationNumber,
      revisionNumber: envelope.revisionNumber,
      currency: envelope.currency,
      validUntil: envelope.validUntil,
      terms: envelope.terms,
      customerSnapshot: envelope.customerSnapshot,
      items: envelope.items,
    },
    output: {
      totalDiscount: verified.output.totalDiscount,
      taxableBase: verified.output.taxableBase,
      tax: verified.output.tax,
      grandTotal: verified.output.grandTotal,
    },
  };
}

function money(value: unknown, field: string): string {
  return parseCommercialDecimal(value, "money", field).toFixed(2);
}

function lineText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\r\n]/.test(value)) {
    throw new CommercialDocumentError(field, 409);
  }
  return value;
}

/**
 * Renders only the sealed snapshot fields required for a customer quotation.
 * Email, phone, access tokens and any other snapshot fields are not read or printed.
 */
export async function renderSealedQuotationPdf(verified: SealedPdfSource, canonicalInput: unknown): Promise<Buffer> {
  const number = lineText(verified.envelope.quotationNumber, "QUOTATION_NUMBER_INVALID", 13);
  quotationPdfFilename(number);
  const revision = verified.envelope.revisionNumber;
  if (typeof revision !== "string" || !/^[1-9]\d{0,8}$/.test(revision)) {
    throw new CommercialDocumentError("QUOTATION_REVISION_INVALID", 409);
  }
  const currency = verified.envelope.currency;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw new CommercialDocumentError("QUOTATION_CURRENCY_INVALID", 409);
  }
  const validUntil = verified.envelope.validUntil;
  if (typeof validUntil !== "string" || !Number.isFinite(Date.parse(validUntil)) || /[\r\n]/.test(validUntil)) {
    throw new CommercialDocumentError("QUOTATION_VALIDITY_INVALID", 409);
  }
  const terms = verified.envelope.terms;
  if (typeof terms !== "string" || terms.length > 8000) throw new CommercialDocumentError("QUOTATION_TERMS_INVALID", 409);
  const customer = verified.envelope.customerSnapshot;
  if (!customer || typeof customer !== "object" || Array.isArray(customer)) {
    throw new CommercialDocumentError("CUSTOMER_NAME_REQUIRED", 409);
  }
  const record = customer as { name?: unknown; company?: unknown };
  const name = lineText(record.name, "CUSTOMER_NAME_REQUIRED", 200);
  const company = record.company === null || record.company === undefined ? "" : lineText(record.company, "CUSTOMER_NAME_REQUIRED", 200);
  if (!Array.isArray(verified.envelope.items) || verified.envelope.items.length === 0) {
    throw new CommercialDocumentError("QUOTATION_ITEMS_REQUIRED", 409);
  }
  const items = verified.envelope.items.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CommercialDocumentError("QUOTATION_ITEM_INVALID", 409);
    const item = raw as { description?: unknown; quantity?: unknown; unitPrice?: unknown; taxRate?: unknown };
    return {
      description: lineText(item.description, "QUOTATION_ITEM_INVALID", 500),
      quantity: parseCommercialDecimal(item.quantity, "quantity", "quantity").toFixed(4),
      unitPrice: money(item.unitPrice, "unitPrice"),
      taxRate: parseCommercialDecimal(item.taxRate, "taxRate", "taxRate").toFixed(4),
    };
  });
  if (!canonicalInput || typeof canonicalInput !== "object" || Array.isArray(canonicalInput) || !("engineInput" in canonicalInput)) {
    throw new CommercialDocumentError("COMMERCIAL_SNAPSHOT_MISMATCH", 409);
  }
  const priced = calculateCommercialQuote((canonicalInput as { engineInput: CommercialQuotePricingInput }).engineInput, [{ code: currency, decimalPlaces: 2 }]);
  const pricing = {
    totalDiscount: money(verified.output.totalDiscount, "totalDiscount"),
    taxableBase: money(verified.output.taxableBase, "taxableBase"),
    tax: money(verified.output.tax, "tax"),
    grandTotal: money(verified.output.grandTotal, "grandTotal"),
  };
  if (priced.currency !== currency || priced.totalDiscount !== pricing.totalDiscount || priced.taxableBase !== pricing.taxableBase || priced.tax !== pricing.tax || priced.grandTotal !== pricing.grandTotal) {
    throw new CommercialDocumentError("COMMERCIAL_SNAPSHOT_MISMATCH", 409);
  }

  const doc = new PDFDocument({ margin: 50, size: "A4", compress: false });
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => { chunks.push(chunk); });
  doc.pipe(stream);
  doc.fontSize(18).text(`Quotation ${number}`);
  doc.fontSize(11).text(`Revision ${revision}`);
  doc.text(`Customer ${name}`);
  if (company) doc.text(`Company ${company}`);
  doc.text(`Currency ${currency}`);
  doc.text(`Valid until ${validUntil}`);
  doc.moveDown();
  for (const item of items) {
    doc.text(`${item.description}  qty ${item.quantity}  unit ${item.unitPrice}  tax ${item.taxRate}%`);
  }
  doc.moveDown();
  doc.text(`Discount ${pricing.totalDiscount}`);
  doc.text(`Taxable base ${pricing.taxableBase}`);
  doc.text(`Tax ${pricing.tax}`);
  doc.text(`Total ${pricing.grandTotal} ${currency}`);
  if (terms) {
    doc.moveDown();
    doc.text(terms);
  }
  doc.end();
  await once(stream, "end");
  return Buffer.concat(chunks);
}
