// Offline quotation PDF checks. No database, SMTP, or browser session.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadWith, req } = require("./commercial-test-loader.cjs");
const { Prisma } = req("@prisma/client");

const doc = loadWith()("services/commercial-document.service.ts");
const pdf = loadWith()("services/commercial-quotation-pdf.ts");
const config = () => ({ version: "v1", currency: { code: "INR", decimalPlaces: 2 }, timezone: "Asia/Kolkata", approval: { mode: "enabled", percentageThreshold: "10", amountThreshold: "50" }, zeroSubtotal: "require_approval" });
const line = () => ({ position: "0", description: "Consulting", quantity: "1", unitPrice: "100.00", taxRate: "18" });
const secret = "customer-link-token-should-not-appear";
const email = "hidden.customer@example.invalid";
const phone = "+910000000000";

function priced() {
  return doc.normalizeQuoteInput({ items: [line()], discount: { percentage: "0", fixedAmount: "0" } }, doc.parseCommercialConfiguration(config()));
}

/** PDFKit writes WinAnsi text as kerned hex. Join those strings in order. */
function pdfText(bytes) {
  const raw = bytes.toString("latin1");
  const parts = [];
  for (const array of raw.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    for (const hex of array[1].matchAll(/<([0-9A-Fa-f]+)>/g)) parts.push(Buffer.from(hex[1], "hex").toString("latin1"));
  }
  return { raw, text: parts.join("") };
}

function excludes(raw, value) {
  assert.equal(raw.includes(value), false);
  assert.equal(raw.toLowerCase().includes(Buffer.from(value, "utf8").toString("hex")), false);
}

function source(normalized, grandTotal = normalized.pricingOutput.grandTotal) {
  return {
    envelope: {
      quotationNumber: "QT-2026-00001",
      revisionNumber: "1",
      currency: "INR",
      validUntil: "2026-02-01T00:00:00.000Z",
      terms: "Net 15",
      customerSnapshot: { version: "mm-commercial-customer-v1", id: "contact-secret-id", name: "Synthetic Customer", email, phone, company: "Synthetic Co", token: secret },
      items: normalized.items,
    },
    output: { ...normalized.pricingOutput, grandTotal },
  };
}

test("sealed pdf reprints server pricing and omits customer secrets", async () => {
  const normalized = priced();
  assert.equal(normalized.pricingOutput.grandTotal, "118.00");
  const bytes = await pdf.renderSealedQuotationPdf(source(normalized), { engineInput: normalized.engineInput });
  const { raw, text } = pdfText(bytes);
  assert.match(raw, /^%PDF-/);
  assert.match(text, /QT-2026-00001/);
  assert.match(text, /Total 118\.00 INR/);
  assert.match(text, /Synthetic Customer/);
  assert.match(text, /Company Synthetic Co/);
  for (const hidden of [secret, email, phone, "contact-secret-id"]) excludes(raw, hidden);
  assert.equal(pdf.quotationPdfFilename("QT-2026-00001"), "QT-2026-00001.pdf");
});

test("pdf filename and mismatched pricing fail closed", async () => {
  const normalized = priced();
  assert.throws(() => pdf.quotationPdfFilename("..\\secret"), error => error.code === "QUOTATION_NUMBER_INVALID");
  assert.throws(() => pdf.quotationPdfFilename("QT-2026-00001.pdf"), error => error.code === "QUOTATION_NUMBER_INVALID");
  await assert.rejects(pdf.renderSealedQuotationPdf(source(normalized, "1.00"), { engineInput: normalized.engineInput }), error => error.code === "COMMERCIAL_SNAPSHOT_MISMATCH");
  await assert.rejects(pdf.renderSealedQuotationPdf(source(normalized, 118), { engineInput: normalized.engineInput }), error => error.name === "CommercialValueError");
  await assert.rejects(pdf.renderSealedQuotationPdf(source(normalized), {}), error => error.code === "COMMERCIAL_SNAPSHOT_MISMATCH");
  await assert.rejects(pdf.renderSealedQuotationPdf(source(normalized), { engineInput: { ...normalized.engineInput, currency: "USD" } }), error => error.code === "COMMERCIAL_SNAPSHOT_MISMATCH" || error.code === "INVALID_COMMERCIAL_VALUE" || error.name === "CommercialValueError");
});

function fixture({ deny = false } = {}) {
  let state = { quotes: [], revisions: [], snapshots: [], items: [], events: [], audits: [], requests: [], approvals: [], sequence: 0 };
  const reads = { snapshots: 0 };
  const tx = {
    async $queryRaw() { return []; },
    async $executeRaw() { return 1; },
    business: { async findUniqueOrThrow() { return { settings: { commercial: config() } }; } },
    businessMember: { async findUnique() { return { user: { isDisabled: false } }; } },
    contact: { async findFirstOrThrow() { return { id: "contactA", name: "Synthetic Customer", email, phone, company: "Synthetic Co" }; } },
    quotationSequence: { async upsert() { return { lastValue: ++state.sequence }; } },
    quotation: {
      async create({ data }) { const q = { id: "q1", version: 1, ...data }; state.quotes.push(q); return q; },
      async update({ data }) { Object.assign(state.quotes[0], data); return state.quotes[0]; },
      async updateMany({ where, data }) { if (state.quotes[0].version !== where.version) return { count: 0 }; state.quotes[0].version++; return { count: 1 }; },
      async findFirst({ where } = {}) { return state.quotes.find(q => (!where || (q.id === where.id && q.businessId === where.businessId))) ?? null; },
    },
    quotationRevision: {
      async create({ data }) { const r = { id: "r1", version: 1, state: "draft", sentAt: null, quotationId: "q1", ...data }; state.revisions.push(r); return r; },
      async update({ data }) { Object.assign(state.revisions[0], data); return state.revisions[0]; },
      async findFirst({ where } = {}) {
        const r = state.revisions[0];
        if (!r || (where && (where.id !== r.id || where.businessId !== r.businessId || (where.quotationId && where.quotationId !== r.quotationId)))) return null;
        return r;
      },
      async updateMany() { return { count: 1 }; },
    },
    quotationPricingSnapshot: {
      async create({ data }) { const r = { id: "s1", ...data }; state.snapshots.push(r); return r; },
      async update() { state.snapshots[0].sealedAt = new Date(); return state.snapshots[0]; },
      async findFirst({ where } = {}) {
        reads.snapshots++;
        const snap = state.snapshots.find(s => !where || (s.id === where.id && s.businessId === where.businessId));
        return snap ? { ...snap, revision: state.revisions[0] } : null;
      },
    },
    quotationRevisionItem: {
      async findMany({ where }) {
        return state.items.filter(i => i.businessId === where.businessId && i.snapshotId === where.snapshotId).map(i => ({ ...i, quantity: new Prisma.Decimal(i.quantity), unitPrice: new Prisma.Decimal(i.unitPrice), taxRate: new Prisma.Decimal(i.taxRate) }));
      },
      async createMany({ data }) { state.items.push(...data); return { count: data.length }; },
    },
    quotationApprovalHistory: { async create({ data }) { state.approvals.push(data); return data; } },
    quotationEvent: { async create({ data }) { state.events.push(data); return data; } },
    auditLog: { async create({ data }) { state.audits.push(data); return data; } },
    commercialMutationRequest: {
      async findUnique({ where }) { const w = where.businessId_actorUserId_operation_key; return state.requests.find(r => r.key === w.key && r.operation === w.operation && r.actorUserId === w.actorUserId) ?? null; },
      async create({ data }) { state.requests.push(data); return data; },
    },
  };
  const root = { $transaction: async (fn, options) => { assert.equal(options.isolationLevel, "Serializable"); return fn(tx); } };
  const service = loadWith({
    "../lib/prisma.js": { prisma: root },
    "./commercial-access.service.js": {
      CommercialAccessError: class extends Error {},
      async resolveCommercialActionAccess() { if (deny) throw new Error("authorization denied"); return { userId: "ownerA", businessId: "A", role: "owner", permissions: {} }; },
      async assertCommercialReferences() {},
      async buildCommercialReferenceScope() { return { contactWhere: {}, dealWhere: {} }; },
    },
    "./commercial-billing-access.service.js": { async evaluateCommercialBillingAccess() { return { allowed: true }; } },
  })("services/quotation.service.ts");
  return { service, state: () => state, reads };
}

const input = () => ({ contactId: "contactA", dealId: "dealA", ownerUserId: "ownerA", issueDate: "2026-01-01T00:00:00.000Z", validUntil: "2026-02-01T00:00:00.000Z", terms: "Terms", notes: "", pricing: { items: [line()] } });

test("authorized sealed snapshot download excludes contact secrets", async () => {
  const f = fixture();
  const created = await f.service.createQuotation({ userId: "ownerA", businessId: "A" }, "pdf-key", input());
  assert.match(created.number, /^QT-\d{4}-\d{5}$/);
  const file = await f.service.quotationSnapshotPdf({ userId: "ownerA", businessId: "A" }, created.quotationId, created.snapshotId);
  assert.equal(file.filename, `${created.number}.pdf`);
  const { raw, text } = pdfText(file.bytes);
  assert.match(raw, /^%PDF-/);
  assert.match(text, new RegExp(created.number));
  assert.match(text, /Total 118\.00 INR/);
  excludes(raw, email);
  excludes(raw, phone);
});

test("pdf authorization denial reads no quotation snapshot", async () => {
  const f = fixture({ deny: true });
  await assert.rejects(f.service.quotationSnapshotPdf({ userId: "ownerA", businessId: "A" }, "q1", "s1"), /authorization denied/);
  assert.equal(f.reads.snapshots, 0);
  assert.equal(f.state().quotes.length, 0);
});

test("missing, foreign and unsealed snapshots do not render", async () => {
  const f = fixture();
  const created = await f.service.createQuotation({ userId: "ownerA", businessId: "A" }, "pdf-key", input());
  await assert.rejects(f.service.quotationSnapshotPdf({ userId: "ownerA", businessId: "B" }, created.quotationId, created.snapshotId), error => error.code === "QUOTATION_NOT_FOUND");
  await assert.rejects(f.service.quotationSnapshotPdf({ userId: "ownerA", businessId: "A" }, created.quotationId, "other-snapshot"), error => error.code === "QUOTATION_SNAPSHOT_CONFLICT");
  f.state().snapshots[0].sealedAt = null;
  await assert.rejects(f.service.quotationSnapshotPdf({ userId: "ownerA", businessId: "A" }, created.quotationId, created.snapshotId), error => error.code === "QUOTATION_SNAPSHOT_CONFLICT");
});

test("staff and customer surfaces keep the unpaid label and body-only pdf token", () => {
  const root = path.resolve(__dirname, "../../..");
  const staff = fs.readFileSync(path.join(root, "apps/web/app/commercial/page.tsx"), "utf8");
  const customer = fs.readFileSync(path.join(root, "apps/web/app/quotation/[token]/page.tsx"), "utf8");
  const staffRoute = fs.readFileSync(path.join(root, "apps/api/src/routes/quotation.routes.ts"), "utf8");
  const customerRoute = fs.readFileSync(path.join(root, "apps/api/src/routes/quotation-customer.routes.ts"), "utf8");
  assert.match(staff, /invoice\.statusLabel/);
  assert.match(staff, /r\.statusLabel/);
  assert.doesNotMatch(staff, /\{invoice\.status\}/);
  assert.doesNotMatch(staff, /\{r\.status\}/);
  assert.match(staff, /\/snapshots\/\$\{encodeURIComponent\(snapshot\.id\)\}\/pdf/);
  assert.match(customer, /quotation-customer\/pdf/);
  assert.match(customer, /JSON\.stringify\(\{token\}\)/);
  assert.match(customer, /credentials:\s*"omit"/);
  assert.match(customer, /referrerPolicy:\s*"no-referrer"/);
  assert.doesNotMatch(customer, /quotation-customer\/pdf\?/);
  assert.doesNotMatch(customer, /\/pdf\/\$\{token\}/);
  const staffPdf = staffRoute.indexOf("/:id/snapshots/:snapshotId/pdf");
  const staffGet = staffRoute.indexOf('quotationRouter.get("/:id"');
  assert.ok(staffPdf > 0 && staffGet > staffPdf);
  const customerPdf = customerRoute.indexOf('quotationCustomerRouter.post("/pdf"');
  const customerView = customerRoute.indexOf('quotationCustomerRouter.post("/view"');
  assert.ok(customerPdf > 0 && customerView > customerPdf);
  assert.match(customerRoute, /object\(req\.body,\["token"\]\)/);
  assert.doesNotMatch(customerRoute, /req\.query/);
});
