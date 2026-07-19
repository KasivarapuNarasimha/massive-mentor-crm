/**
 * Professional SaaS invoice PDF generation (pdfkit).
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { toMoneyNumber } from "@/lib/money";

function invoicesDir(): string {
  const base = env.BACKUP_DIR || path.join(process.cwd(), "storage");
  const dir = path.join(base, "invoices");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function generateBillingInvoicePdf(paymentId: string): Promise<{
  absolutePath: string;
  relativeUrl: string;
  invoiceNumber: string;
}> {
  const payment = await prisma.billingPayment.findUnique({
    where: { id: paymentId },
    include: {
      plan: true,
      business: {
        include: {
          owner: { select: { name: true, email: true } },
        },
      },
      coupon: true,
    },
  });
  if (!payment) throw new Error("Payment not found");
  if (payment.status !== "paid") throw new Error("Invoice only for paid payments");

  const PDFDocument = (await import("pdfkit")).default;
  const invoiceNumber = payment.invoiceNumber || `MM-INV-${payment.id.slice(-8).toUpperCase()}`;
  const fileName = `${invoiceNumber}.pdf`;
  const absolutePath = path.join(invoicesDir(), fileName);

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const stream = fs.createWriteStream(absolutePath);
  doc.pipe(stream);

  // Header
  doc.fontSize(20).fillColor("#18181b").text("Massive Mentor CRM", { align: "left" });
  doc.fontSize(10).fillColor("#52525b").text("AI Business Operating System", { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(9).text(`GSTIN: ${process.env.COMPANY_GSTIN || "Applied as per invoice"}`);
  doc.text(`Support: ${env.SUPPORT_EMAIL || "team@massivementor.in"}`);
  doc.text(`WhatsApp: ${env.SUPPORT_WHATSAPP || ""}`);
  doc.moveDown();

  doc.fontSize(16).fillColor("#18181b").text("TAX INVOICE", { align: "right" });
  doc.fontSize(10).fillColor("#52525b");
  doc.text(`Invoice No: ${invoiceNumber}`, { align: "right" });
  doc.text(
    `Date: ${payment.paidAt ? new Date(payment.paidAt).toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN")}`,
    { align: "right" }
  );
  if (payment.razorpayPaymentId) {
    doc.text(`Razorpay Payment ID: ${payment.razorpayPaymentId}`, { align: "right" });
  }
  doc.moveDown(1.5);

  // Bill to
  doc.fontSize(11).fillColor("#18181b").text("Bill To", { underline: true });
  doc.fontSize(10).fillColor("#3f3f46");
  doc.text(payment.business.name);
  if (payment.business.owner?.name) doc.text(payment.business.owner.name);
  if (payment.business.owner?.email || payment.business.billingEmail) {
    doc.text(payment.business.owner?.email || payment.business.billingEmail || "");
  }
  if (payment.business.gstNumber) doc.text(`GST: ${payment.business.gstNumber}`);
  if (payment.business.address) doc.text(payment.business.address);
  doc.moveDown();

  // Line items table — coerce Prisma Decimal → number for arithmetic/display
  const amountN = toMoneyNumber(payment.amount);
  const gstN = toMoneyNumber(payment.gst);
  const discountN = toMoneyNumber(payment.discountAmount);
  const base = amountN - gstN;
  const y = doc.y;
  doc.fontSize(10).fillColor("#18181b");
  doc.text("Description", 50, y);
  doc.text("Billing", 280, y);
  doc.text("Amount (INR)", 420, y, { width: 120, align: "right" });
  doc.moveTo(50, y + 15).lineTo(545, y + 15).strokeColor("#d4d4d8").stroke();
  doc.moveDown();

  const planName = payment.plan?.name || "Subscription";
  const cycle = payment.billingCycle || payment.plan?.billingCycle || "—";
  doc.fillColor("#3f3f46");
  doc.text(planName, 50);
  doc.text(String(cycle), 280, doc.y - 12);
  doc.text(base.toFixed(2), 420, doc.y - 12, { width: 120, align: "right" });
  doc.moveDown(0.5);

  if (discountN > 0) {
    doc.text("Discount", 50);
    doc.text(`- ${discountN.toFixed(2)}`, 420, doc.y - 12, {
      width: 120,
      align: "right",
    });
    doc.moveDown(0.5);
  }

  doc.text(`GST (18%)`, 50);
  doc.text(gstN.toFixed(2), 420, doc.y - 12, { width: 120, align: "right" });
  doc.moveDown();
  doc.fontSize(12).fillColor("#18181b").text("Total Paid", 50);
  doc.text(amountN.toFixed(2), 420, doc.y - 14, { width: 120, align: "right" });
  doc.moveDown(2);

  doc.fontSize(9).fillColor("#71717a");
  doc.text(
    "This is a computer-generated invoice for SaaS subscription services. Payment collected via Razorpay.",
    { align: "left" }
  );
  doc.text("Massive Mentor · massivementor.in", { align: "left" });

  doc.end();

  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });

  const relativeUrl = `/api/billing/invoices/${payment.id}/pdf`;
  await prisma.billingPayment.update({
    where: { id: payment.id },
    data: {
      invoiceNumber,
      invoiceUrl: relativeUrl,
      invoicePdfPath: absolutePath,
    },
  });

  return { absolutePath, relativeUrl, invoiceNumber };
}
