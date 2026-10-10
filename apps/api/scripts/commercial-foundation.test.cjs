// Offline only: actual foundation/policy/math functions; Prisma I/O is mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../../..");
const localRequire = createRequire(path.join(root, "apps/api/package.json"));
const ts = localRequire("typescript");
const { Prisma } = localRequire("@prisma/client");

function loader(db, globals = {}) {
  const cache = new Map();
  function load(relative) {
    const file = path.resolve(root, "apps/api/src", relative);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const source = fs.readFileSync(file, "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    vm.runInNewContext(js, {
      exports, console, Date, ...globals,
      require(id) {
        if (id === "@prisma/client") return { Prisma };
        if (id === "node:async_hooks") return require(id);
        if (id === "./audit.service.js" && globals.auditStub) return {recordAudit:globals.auditStub};
        const dependency = path.resolve(path.dirname(file), id.replace(/\.js$/, ".ts"));
        if (dependency.endsWith(path.join("lib", "prisma.ts"))) return { prisma: db };
        if (dependency.endsWith(path.join("services", "field-engine.service.ts"))) {
          return { getUserBusinessId() { throw Error("Forbidden legacy repair resolver"); } };
        }
        if (id.startsWith(".")) return load(path.relative(path.join(root, "apps/api/src"), dependency));
        throw Error("Unexpected dependency: " + id);
      }
    }, { filename: file });
    return exports;
  }
  return load;
}
function authFixture() {
  const state = {
    user: { isDisabled: false, role: "super_admin", platformRole: "super_admin" },
    businesses: [{ id: "A", status: "active", settings: {} }, { id: "B", status: "active", settings: {} }],
    memberships: [{ userId: "actor", businessId: "A", role: "owner", permissions: {} }],
    contacts: [
      { id: "cA", businessId: "A", deletedAt: null },
      { id: "cB", businessId: "B", deletedAt: null },
      { id: "legacy", businessId: null, deletedAt: null },
      { id: "deleted", businessId: "A", deletedAt: new Date() },
    ],
    deals: [{ id: "dA", businessId: "A", contactId: "cA" },
      { id: "dB", businessId: "B", contactId: "cB" },
      { id: "wrong", businessId: "A", contactId: "other" }],
    writes: [], reads: [],
  };
  const forbid = method => async () => { state.writes.push(method); throw Error("Forbidden write: " + method); };
  const db = {
    businessMember: { async findUnique({ where }) {
      const { userId, businessId } = where.businessId_userId; state.reads.push({ userId, businessId });
      const m = state.memberships.find(m => m.userId === userId && m.businessId === businessId);
      return m ? { ...m, user: state.user, business: state.businesses.find(b => b.id === businessId) } : null;
    } },
    contact: { async findFirst({ where }) { return state.contacts.find(r => Object.entries(where).every(([k,v]) => r[k] === v)) || null; } },
    deal: { async findFirst({ where }) { return state.deals.find(r => Object.entries(where).every(([k,v]) => r[k] === v)) || null; } },
  };
  for (const model of ["businessMember", "business", "user", "contact", "deal", "businessProfile"]) {
    db[model] ??= {};
    for (const method of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) db[model][method] = forbid(model + "." + method);
  }
  db.$executeRawUnsafe = forbid("raw"); db.$transaction = forbid("transaction");
  const load = loader(db);
  return { state, db, load, access: load("services/commercial-access.service.ts"), context: load("services/strict-request-context.service.ts") };
}
for (const role of ["owner", "business_admin", "admin", "ceo", "finance"]) test(`exact enabled ${role} membership succeeds without writes`, async () => {
  const f = authFixture(); f.state.memberships[0].role = role;
  const ctx = await f.access.resolveCommercialAccess("actor", "A");
  assert.equal(ctx.role, role); assert.equal(ctx.businessId, "A"); assert(Object.isFrozen(ctx));
  assert.deepEqual(f.state.writes, []);
});
const authFailures = [
  ["missing membership despite global super_admin", f => { f.state.memberships = []; }],
  ["foreign membership only", f => { f.state.memberships[0].businessId = "B"; }],
  ["disabled actor", f => { f.state.user.isDisabled = true; }],
  ["inactive business", f => { f.state.businesses[0].status = "inactive"; }],
  ["deleted business", f => { f.state.businesses[0].status = "deleted"; }],
  ["sales executive with Finance module", f => { Object.assign(f.state.memberships[0], { role: "sales_executive", permissions: { modules: ["finance"] } }); }],
  ["role from another membership cannot authorize", f => { f.state.memberships[0].role = "sales_executive"; f.state.memberships.push({ userId: "actor", businessId: "B", role: "owner", permissions: {} }); }],
  ["explicit member module denial", f => { f.state.memberships[0].permissions = { customized: true, modules: ["leads"] }; }],
  ["customized empty modules", f => { f.state.memberships[0].permissions = { customized: true, modules: [] }; }],
  ["customized missing modules", f => { f.state.memberships[0].permissions = { customized: true }; }],
  ["malformed modules string", f => { f.state.memberships[0].permissions = { modules: "finance" }; }],
  ["malformed permission array", f => { f.state.memberships[0].permissions = []; }],
  ["workspace module denial", f => { f.state.businesses[0].settings = { moduleAccess: { customized: true, enabled: ["leads"] } }; }],
  ["malformed customized workspace modules", f => { f.state.businesses[0].settings = { moduleAccess: { customized: true, enabled: "finance" } }; }],
];
for (const [name, change] of authFailures) test(name, async () => {
  const f = authFixture(); change(f); await assert.rejects(f.access.resolveCommercialAccess("actor", "A")); assert.deepEqual(f.state.writes, []);
});
test("multiple memberships select explicit business, never heuristic counts", async () => {
  const f = authFixture(); f.state.memberships.push({ userId: "actor", businessId: "B", role: "finance", permissions: {} });
  assert.equal((await f.access.resolveCommercialAccess("actor", "B")).role, "finance");
  assert.deepEqual(f.state.reads, [{ userId: "actor", businessId: "B" }]);
});
test("pinned business disagreement and actor mismatch fail closed", async () => {
  const f = authFixture(); const ctx = await f.access.resolveCommercialAccess("actor", "A");
  await f.context.runWithStrictBusinessContext(ctx, async () => {
    await assert.rejects(f.access.resolveCommercialAccess("actor", "B"));
    await assert.rejects(f.access.resolveCommercialAccess("other", "A"));
  });
  assert.deepEqual(f.state.writes, []);
});
test("pinned role cannot replace newly revoked authority", async () => {
  const f = authFixture(); const ctx = await f.access.resolveCommercialAccess("actor", "A");
  await f.context.runWithStrictBusinessContext(ctx, async () => {
    f.state.memberships[0].role = "sales_executive";
    await assert.rejects(f.access.resolveCommercialAccess("actor", "A"));
  });
});
test("Finance and ERP sales module policy remain distinct", async () => {
  const f = authFixture(); f.state.memberships[0].permissions = { customized: true, modules: ["finance"] };
  await f.access.resolveCommercialAccess("actor", "A", "finance");
  await assert.rejects(f.access.resolveCommercialAccess("actor", "A", "erp_sales"));
});
test("blank business never invokes legacy fallback", async () => {
  const f = authFixture(); await assert.rejects(f.access.resolveCommercialAccess("actor", "")); assert.equal(f.state.reads.length, 0);
});
test("matching customer and deal succeed, with no writes", async () => {
  const f = authFixture(); const r = await f.access.assertCommercialReferences("actor", "A", { contactId: "cA", dealId: "dA" });
  assert.equal(r.contactId, "cA"); assert.equal(r.dealId, "dA"); assert.deepEqual(f.state.writes, []);
});
for (const input of [{ contactId: "cB" }, { contactId: "legacy" }, { contactId: "deleted" },
  { contactId: "cA", dealId: "dB" }, { contactId: "cA", dealId: "wrong" }]) test(`reject foreign/null/deleted/mismatched reference ${JSON.stringify(input)}`, async () => {
  const f = authFixture(); await assert.rejects(f.access.assertCommercialReferences("actor", "A", input)); assert.deepEqual(f.state.writes, []);
});

const mathLoad = loader({});
const money = mathLoad("lib/commercial-money.ts");
const pricing = mathLoad("services/commercial-pricing.service.ts");
for (const input of [null, undefined, "", " ", " 1.00", "1.00 ", "abc", "NaN", "Infinity", "1e3", "0x10", "1,000", "$1", "1.", ".5", true, {}, [], Infinity, -Infinity, NaN, "-0.01", "0.001", "10000000000000000", "9".repeat(65)]) test(`strict money rejects ${String(input)}`, () => {
  assert.throws(() => money.parseCommercialDecimal(input, "money"), e => e.code === "INVALID_COMMERCIAL_VALUE");
});
test("exact maximum string retained without Number conversion", () => {
  assert.equal(money.parseCommercialDecimal("9999999999999999.99", "money").toFixed(2), "9999999999999999.99");
});
for (const kind of ["money", "quantity", "taxRate"]) test(`only canonical strings accepted for ${kind}`, () => {
  for (const input of [0, 1, 12.34, new Prisma.Decimal("12.34"), "01", "00.5", "+1", "-0"]) {
    assert.throws(() => money.parseCommercialDecimal(input, kind), e => e.code === "INVALID_COMMERCIAL_VALUE");
  }
  assert.equal(money.parseCommercialDecimal("12.34", kind).toString(), "12.34");
});
test("JSON number loses cents before validation and must be rejected", () => {
  const parsed = JSON.parse('{"amount":90071992547409.91}').amount;
  assert.equal(new Prisma.Decimal(parsed.toString()).toFixed(2), "90071992547409.90");
  assert.throws(() => money.parseCommercialDecimal(parsed, "money"));
  assert.equal(money.parseCommercialDecimal("90071992547409.91", "money").toFixed(2), "90071992547409.91");
});
for (const field of ["quantity", "unitPrice", "taxRate"]) test(`pricing rejects numeric ${field}`, () => {
  assert.throws(() => pricing.calculateCommercialLine({ quantity: "1", unitPrice: "1", taxRate: "0", [field]: 1 }));
});

test("unsafe numeric precision and fake Decimal inputs rejected", () => {
  assert.throws(() => money.parseCommercialDecimal(999999999999999, "money"));
  assert.throws(() => money.parseCommercialDecimal({ toString: () => "12.34" }, "money"));
  assert.throws(() => money.parseCommercialDecimal(new Prisma.Decimal(Infinity), "money"));
});
test("quantity/tax storage bounds and scales", () => {
  assert.equal(money.parseCommercialDecimal("99999999999999.9999", "quantity").toString(), "99999999999999.9999");
  assert.equal(money.parseCommercialDecimal("9999.9999", "taxRate").toString(), "9999.9999");
  assert.throws(() => money.parseCommercialDecimal("10000", "taxRate"));
  assert.throws(() => money.parseCommercialDecimal("1.00001", "quantity"));
});
function actualErpTotals(items) {
  const source = fs.readFileSync(path.join(root, "apps/api/src/services/erp-sales.service.ts"), "utf8");
  const ast = ts.createSourceFile("erp.ts", source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "recalcTotals");
  assert(node, "existing ERP pricing function required");
  const code = ts.transpileModule(node.getText(ast) + "\nexports.run = recalcTotals;", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {}; vm.runInNewContext(code, { exports, toDecimal: mathLoad("lib/money.ts").toDecimal });
  return exports.run(items);
}
for (const items of [
  [{ quantity: "2", unitPrice: "100", taxRate: "18" }],
  [{ quantity: "1.2345", unitPrice: "99.99", taxRate: "18" }, { quantity: "2", unitPrice: "0.01", taxRate: "5" }],
  [{ quantity: "0.5", unitPrice: "0.01", taxRate: "0" }],
]) test(`pricing matches actual existing ERP ${JSON.stringify(items)}`, () => {
  const strict = pricing.calculateCommercialTotals(items);
  const legacy = actualErpTotals(items.map(x => ({ qtyOrdered: x.quantity, unitPrice: x.unitPrice, taxRate: x.taxRate })));
  for (const k of ["subtotal", "taxAmount", "total"]) assert.equal(strict[k].toFixed(2), legacy[k].toFixed(2));
});
test("line and aggregate overflow rejected rather than stored", () => {
  assert.throws(() => pricing.calculateCommercialLine({ quantity: "2", unitPrice: "9999999999999999.99", taxRate: "0" }));
  assert.throws(() => pricing.calculateCommercialTotals(Array(2).fill({ quantity: "1", unitPrice: "6000000000000000", taxRate: "0" })));
  assert.throws(() => pricing.calculateCommercialLine({ quantity: "1", unitPrice: "9999999999999999.99", taxRate: "18" }));
});
test("empty lines, zero/negative quantities and missing rate rejected", () => {
  assert.throws(() => pricing.calculateCommercialTotals([]));
  for (const quantity of ["0", "-1"]) assert.throws(() => pricing.calculateCommercialLine({ quantity, unitPrice: "1", taxRate: "0" }));
  assert.throws(() => pricing.calculateCommercialLine({ quantity: "1", unitPrice: "1", taxRate: undefined }));
});
test("legacy permissive helper remains unchanged", () => {
  assert.equal(mathLoad("lib/money.ts").toDecimal("invalid").toString(), "0");
});

function sequenceFixture(year = new Date().getFullYear()) {
  const state = { rows: new Map(), transactions: 0, trace: [], failLock: false };
  function tx(rows) { return {
    async $executeRawUnsafe(sql, key) { state.trace.push(["lock", sql, key]); if (state.failLock) throw Error("lock failed"); },
    invoiceSequence: {
      async findUnique({ where }) { state.trace.push(["read", where.key]); return rows.get(where.key) || null; },
      async create({ data }) { state.trace.push(["create", data.key]); assert(!rows.has(data.key)); rows.set(data.key, { ...data }); return rows.get(data.key); },
      async update({ where, data }) { state.trace.push(["update", where.key]); const row = { ...rows.get(where.key) }; row.lastValue += data.lastValue.increment; rows.set(where.key, row); return row; },
    }
  }; }
  const db = { async $transaction(callback) {
    state.transactions++; const staged = new Map([...state.rows].map(([k,v]) => [k, { ...v }]));
    const result = await callback(tx(staged)); state.rows = staged; return result;
  } };
  class FixedDate extends Date { constructor() { super(`${year}-06-01T12:00:00Z`); } }
  return { state, db, tx, service: loader(db, { Date: FixedDate })("services/invoice-sequence.service.ts"), year };
}
test("existing one-argument finance numbering format and increment", async () => {
  const f = sequenceFixture(); const prefix = `INV-${f.year}-`;
  assert.equal(await f.service.nextFinanceInvoiceNumber("A"), prefix + "00001");
  assert.equal(await f.service.nextFinanceInvoiceNumber("A"), prefix + "00002");
  assert.equal(f.state.transactions, 2);
  assert.equal(f.state.trace[0][0], "lock"); assert.match(f.state.trace[0][1], /pg_advisory_xact_lock/);
  assert.equal(f.state.trace[0][2], `finance:A:${f.year}`);
});
test("tenant/year namespaces and five-digit minimum preserved", async () => {
  const f = sequenceFixture(2028);
  assert.equal(await f.service.nextFinanceInvoiceNumber("A"), "INV-2028-00001");
  assert.equal(await f.service.nextFinanceInvoiceNumber("B"), "INV-2028-00001");
  f.state.rows.get("finance:A:2028").lastValue = 99999;
  assert.equal(await f.service.nextFinanceInvoiceNumber("A"), "INV-2028-100000");
});
test("supplied transaction owns lock/allocation; no nested root transaction", async () => {
  const f = sequenceFixture(); const staged = new Map();
  assert.equal(await f.service.nextFinanceInvoiceNumber("A", f.tx(staged)), `INV-${f.year}-00001`);
  assert.equal(f.state.transactions, 0); assert.equal(f.state.rows.size, 0); assert.equal(staged.size, 1);
  assert.equal(f.state.trace[0][0], "lock");
});
test("caller rollback discards sequence allocation and propagates failure", async () => {
  const f = sequenceFixture();
  await assert.rejects(f.db.$transaction(async tx => { await f.service.nextFinanceInvoiceNumber("A", tx); throw Error("invoice failed"); }));
  assert.equal(f.state.rows.size, 0);
  assert.equal(await f.service.nextFinanceInvoiceNumber("A"), `INV-${f.year}-00001`);
});
test("lock failure prevents sequence writes", async () => {
  const f = sequenceFixture(); f.state.failLock = true;
  await assert.rejects(f.service.nextFinanceInvoiceNumber("A")); assert.equal(f.state.rows.size, 0);
  assert.equal(f.state.trace.length, 1);
});
test("SaaS and platform numbering remain unchanged", async () => {
  const f = sequenceFixture();
  assert.equal(await f.service.nextSaaSInvoiceNumber(), `MM-INV-${f.year}-000001`);
  assert.equal(await f.service.nextPlatformInvoiceNumber(), `PLT-INV-${f.year}-000001`);
  assert.equal(f.state.transactions, 2);
});


test("large exact multiplication avoids global-precision double rounding", () => {
  const precision = Prisma.Decimal.precision;
  const result = pricing.calculateCommercialLine({ quantity: "99999999999900.0001", unitPrice: "49.99", taxRate: "0" });
  assert.equal(result.amount.toFixed(2), "4998999999995001.00");
  assert.equal(Prisma.Decimal.precision, precision);
});
test("concurrent commercial requests retain independent pinned contexts", async () => {
  const f = authFixture(); f.state.memberships.push({ userId: "actor", businessId: "B", role: "finance", permissions: {} });
  const a = await f.access.resolveCommercialAccess("actor", "A");
  const b = await f.access.resolveCommercialAccess("actor", "B");
  await Promise.all([a, b].map(ctx => f.context.runWithStrictBusinessContext(ctx, async () => {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.access.resolveCommercialAccess("actor", ctx.businessId)).businessId, ctx.businessId);
    await assert.rejects(f.access.resolveCommercialAccess("actor", ctx.businessId === "A" ? "B" : "A"));
  })));
  assert.equal(f.context.getStrictRequestContext("actor"), undefined);
  assert.deepEqual(f.state.writes, []);
});
test("existing invoice database uniqueness declarations remain present", () => {
  const schema = fs.readFileSync(path.join(root, "apps/api/prisma/schema.prisma"), "utf8");
  const invoice = schema.split("model Invoice {")[1].split("\nmodel ")[0];
  assert.match(invoice, /@@unique\(\[businessId, number\]\)/);
  assert.match(invoice, /@@unique\(\[businessId, sourceType, sourceId\]\)/);
});

// Root fixture denies authority: success therefore proves every read uses the supplied client.
test("transaction client supplies membership, customer and deal reads without root fallback", async () => {
  const root = authFixture(); root.state.memberships = [];
  const tx = authFixture(); const reads = [];
  const client = {
    businessMember: { findUnique: async args => { reads.push("member");
      const m = tx.state.memberships[0];
      assert.equal(args.where.businessId_userId.businessId, "A");
      return { ...m, user: tx.state.user, business: tx.state.businesses[0] };
    } },
    contact: { findFirst: async ({where}) => { reads.push("contact"); return tx.state.contacts.find(r => Object.entries(where).every(([k,v]) => r[k] === v)) || null; } },
    deal: { findFirst: async ({where}) => { reads.push("deal"); return tx.state.deals.find(r => Object.entries(where).every(([k,v]) => r[k] === v)) || null; } },
  };
  const result = await root.access.assertCommercialReferences("actor", "A", { contactId: "cA", dealId: "dA" }, "finance", client);
  assert.equal(result.dealId, "dA"); assert.deepEqual(reads, ["member", "contact", "deal"]);
  assert.deepEqual(root.state.reads, []); assert.deepEqual(root.state.writes, []);
  for (const input of [{contactId:"cB"}, {contactId:"cA",dealId:"dB"}, {contactId:"cA",dealId:"wrong"}]) {
    await assert.rejects(root.access.assertCommercialReferences("actor", "A", input, "finance", client));
  }
  tx.state.user.isDisabled = true;
  await assert.rejects(root.access.resolveCommercialAccess("actor", "A", "finance", client));
  assert.deepEqual(root.state.reads, []);
});
test("transaction denial cannot fall back to authorized root client", async () => {
  const f = authFixture();
  const client = { businessMember: { findUnique: async () => null } };
  await assert.rejects(f.access.resolveCommercialAccess("actor", "A", "finance", client));
  assert.deepEqual(f.state.reads, []);
});

function commercialRequestFixture() {
  const f = authFixture();
  f.state.memberships[0].permissions = { customized: true, modules: ["quotations"], commercialActions: ["quotation.create"] };
  f.guard = f.load("middleware/requireCommercialAccess.ts").requireCommercialAccess("quotations", "quotation.create");
  f.req = { user: { id: "actor", platformRole: "super_admin" }, headers: { "x-business-id": "A" }, rawHeaders: ["x-business-id", "A"] };
  f.res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return f;
}
const commercialDenials = [
  ["unauthenticated", f => { delete f.req.user; }, 401],
  ["missing selector", f => { f.req.headers = {}; }],
  ["array selector", f => { f.req.headers["x-business-id"] = ["A", "B"]; }],
  ["duplicate selector", f => { f.req.rawHeaders.push("X-Business-Id", "B"); }],
  ["padded selector", f => { f.req.headers["x-business-id"] = " A"; }],
  ["missing membership", f => { f.state.memberships = []; }],
  ["foreign membership", f => { f.state.memberships[0].businessId = "B"; }],
  ["disabled actor", f => { f.state.user.isDisabled = true; }],
  ["inactive business", f => { f.state.businesses[0].status = "inactive"; }],
  ["deleted business", f => { f.state.businesses[0].status = "deleted"; }],
  ["module denied", f => { f.state.memberships[0].permissions.modules = ["leads"]; }],
  ["implicit owner module denied", f => { delete f.state.memberships[0].permissions.modules; f.state.memberships[0].permissions.customized = false; }],
  ["business module denied", f => { f.state.businesses[0].settings = { moduleAccess: {customized:true,enabled:["leads"]} }; }],
  ["action denied", f => { f.state.memberships[0].permissions.commercialActions = ["quotation.send"]; }],
  ["missing action", f => { delete f.state.memberships[0].permissions.commercialActions; }],
  ["malformed action", f => { f.state.memberships[0].permissions.commercialActions = "quotation.create"; }],
  ["mixed malformed grants", f => { f.state.memberships[0].permissions.commercialActions.push(1); }],
  ["wildcard denied", f => { f.state.memberships[0].permissions.commercialActions.push("*"); }],
  ["malformed modules", f => { f.state.memberships[0].permissions.modules = "finance"; }],
  ["request pin mismatch", f => { f.req.strictBusinessContext = {userId:"actor",businessId:"B"}; }],
  ["request actor mismatch", f => { f.req.strictBusinessContext = {userId:"other",businessId:"A"}; }],
  ["tenant mismatch", f => { f.req.tenant = {userId:"actor",businessId:"B"}; }],
];
for (const [name, change, status = 403] of commercialDenials) test(`commercial HTTP guard rejects ${name} without repairs`, async () => {
  const f = commercialRequestFixture(); change(f); let calls = 0;
  await f.guard(f.req, f.res, () => { calls++; });
  assert.equal(f.res.statusCode, status); assert.equal(calls, 0); assert.deepEqual(f.state.writes, []);
});
test("commercial middleware pins explicit workspace through real service reads and async handler", async () => {
  const f = commercialRequestFixture(); let calls = 0;
  await f.guard(f.req, f.res, async () => {
    await Promise.resolve(); calls++;
    assert.equal(f.context.getStrictRequestContext("actor").businessId, "A");
    assert(Object.isFrozen(f.req.strictBusinessContext));
    await f.access.resolveCommercialActionAccess("actor", "A", "quotations", "quotation.create");
    await assert.rejects(f.access.resolveCommercialActionAccess("actor", "B", "quotations", "quotation.create"));
  });
  assert.equal(calls, 1); assert.equal(f.res.statusCode, 200);
  assert.equal(f.context.getStrictRequestContext("actor"), undefined);
  assert.deepEqual(f.state.writes, []);
});
test("commercial middleware rejects ALS disagreement without replacing the pin", async () => {
  const f = commercialRequestFixture();
  await f.context.runWithStrictBusinessContext({userId:"actor",businessId:"B"}, async () => {
    await f.guard(f.req, f.res, () => assert.fail("must not proceed"));
    assert.equal(f.context.getStrictRequestContext("actor").businessId, "B");
  });
  assert.equal(f.res.statusCode, 403);
});
test("commercial concurrent middleware contexts remain isolated", async () => {
  const f = commercialRequestFixture();
  f.state.memberships.push({...f.state.memberships[0], businessId:"B"});
  const reqB = {...f.req,headers:{"x-business-id":"B"},rawHeaders:["x-business-id","B"]};
  await Promise.all([f.req,reqB].map(req => f.guard(req,f.res,async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(f.context.getStrictRequestContext("actor").businessId,req.headers["x-business-id"]);
  })));
  assert.equal(f.context.getStrictRequestContext("actor"), undefined);
});
test("commercial action write-time revalidation uses transaction, not root authority", async () => {
  const f = commercialRequestFixture();
  const client = {businessMember:{findUnique:async () => ({...f.state.memberships[0], user:f.state.user,business:f.state.businesses[0]})}};
  f.state.memberships = [];
  // Transaction denies independently; root must never be consulted.
  await assert.rejects(f.access.resolveCommercialActionAccess("actor","A","quotations","quotation.create",{businessMember:{findUnique:async()=>null}}));
  assert.deepEqual(f.state.reads,[]);
  // Supply a valid transaction-only snapshot.
  client.businessMember.findUnique = async () => ({role:"owner",permissions:{modules:["quotations"],commercialActions:["quotation.create"]},user:f.state.user,business:f.state.businesses[0]});
  await f.access.resolveCommercialActionAccess("actor","A","quotations","quotation.create",client);
  assert.deepEqual(f.state.reads,[]);
});
test("commercial boundary has no billing/module fallback dependency", () => {
  const source = fs.readFileSync(path.join(root,"apps/api/src/middleware/requireCommercialAccess.ts"),"utf8");
  assert.doesNotMatch(source,/getUserBusinessId|evaluateBillingAccess|enforceLockIfNeeded|requireModuleFromPath/);
  // The actual service's legacy dependency is trapped by loader; all successful tests above exercise it.
});

const actionPolicy = mathLoad("services/commercial-policy.ts");
test("registered action catalog contains exactly the approved names, without default grants", () => {
  assert.equal(actionPolicy.COMMERCIAL_ACTIONS.length,13);
  assert.equal(actionPolicy.isCommercialAction("quotation.unknown"),false);
  assert.equal(actionPolicy.isCommercialAction("*"),false);
});
for (const [role,action,module,allowed] of [
  ["sales_executive","quotation.create","quotations",true],
  ["sales_executive","quotation.send","quotations",true],
  ["sales_manager","quotation.approve","quotations",true],
  ["sales_executive","quotation.approve","quotations",false],
  ["sales_manager","invoice.issue","finance",false],
  ["sales_executive","payment.record","finance",false],
  ["finance","invoice.issue","finance",true],
  ["finance","payment.reverse","finance",true],
  ["finance","commercial.permissions.manage","quotations",false],
  ["owner","commercial.permissions.manage","quotations",true],
  ["business_admin","commercial.policy.manage","quotations",true],
  ["super_admin","commercial.permissions.manage","quotations",false],
  ["manager","quotation.approve","quotations",false],
  ["owner","quotation.acceptance.record","quotations",false],
]) test(`explicit action eligibility ${role}/${action}`, async () => {
  const f=authFixture(); f.state.memberships[0].role=role;
  f.state.memberships[0].permissions={modules:[module],commercialActions:[action]};
  const result=f.access.resolveCommercialActionAccess("actor","A",module,action);
  if(allowed)await result;else await assert.rejects(result);
  assert.deepEqual(f.state.writes,[]);
});
test("quotation action cannot be authorized under finance/ERP", async () => {
  const f=commercialRequestFixture();
  for(const module of ["finance","erp_sales"])await assert.rejects(f.access.resolveCommercialActionAccess("actor","A",module,"quotation.create"));
});
test("sales reference checks retain assignee/deal ownership and exclude foreign tenants", async () => {
  const f=commercialRequestFixture(); f.state.memberships[0].role="sales_executive";
  f.state.contacts[0].assignedTo="other";
  await assert.rejects(f.access.assertCommercialReferences("actor","A",{contactId:"cA"},"quotations",undefined,"quotation.create"));
  f.state.contacts[0].assignedTo="actor";
  await f.access.assertCommercialReferences("actor","A",{contactId:"cA"},"quotations",undefined,"quotation.create");
  f.state.deals[0].userId="other";
  await assert.rejects(f.access.assertCommercialReferences("actor","A",{contactId:"cA",dealId:"dA"},"quotations",undefined,"quotation.create"));
  f.state.deals[0].userId="actor";
  await f.access.assertCommercialReferences("actor","A",{contactId:"cA",dealId:"dA"},"quotations",undefined,"quotation.create");
  await assert.rejects(f.access.assertCommercialReferences("actor","A",{contactId:"cB"},"quotations",undefined,"quotation.create"));
});
function grantFixture() {
  const f=authFixture(); f.state.audit=[]; f.state.locks=[];
  const stamp=new Date("2026-01-01");
  Object.assign(f.state.memberships[0],{id:"actor-m",updatedAt:stamp,permissions:{modules:["quotations","finance"],commercialActions:actionPolicy.COMMERCIAL_ACTIONS.filter(action=>action!=="quotation.acceptance.record")}});
  f.state.memberships.push({id:"target-m",userId:"target",businessId:"A",role:"sales_executive",updatedAt:stamp,permissions:{modules:["leads"],custom:{keep:true}}});
  f.db.business={findUnique:async ({where})=>f.state.businesses.find(b=>b.id===where.id) || null};
  f.db.$queryRawUnsafe=async (...args)=>{f.state.locks.push(args);return [];};
  f.db.businessMember.update=async ({where,data})=>{
    const target=f.state.memberships.find(m=>m.id===where.id&&m.businessId===where.businessId&&m.updatedAt===where.updatedAt);
    if(!target)throw Error("stale write");
    target.permissions=data.permissions; f.state.writes.push("permission-update");return target;
  };
  f.db.auditLog={create:async ({data})=>{if(f.state.failAudit)throw Error("audit failed");f.state.audit.push(data);return data;}};
  f.db.$transaction=async callback=>{
    const before=f.state.memberships.map(m=>({...m,permissions:JSON.parse(JSON.stringify(m.permissions))}));
    const audit=f.state.audit.slice();
    try{return await callback(f.db);}catch(e){f.state.memberships=before;f.state.audit=audit;throw e;}
  };
  f.grants=f.load("services/commercial-permissions.service.ts");
  f.input={actorUserId:"actor",businessId:"A",targetUserId:"target",actions:["quotation.create","quotation.read"],modules:["quotations"],reason:"approved employee duties"};
  return f;
}
test("grant creation preserves unrelated fields/modules, commits audit and revocation takes effect", async () => {
  const f=grantFixture();await f.grants.setCommercialPermissions(f.input);
  let target=f.state.memberships.find(m=>m.userId==="target");
  assert.deepEqual(target.permissions.custom,{keep:true});assert(target.permissions.modules.includes("leads"));
  assert.equal(f.state.audit[0].actorUserId,"actor");assert.equal(f.state.audit[0].businessId,"A");
  assert.equal(f.state.audit[0].metadata.targetUserId,"target");assert.equal(f.state.audit[0].metadata.reason,f.input.reason);
  await f.access.resolveCommercialActionAccess("target","A","quotations","quotation.create");
  await f.grants.setCommercialPermissions({...f.input,actions:[],modules:[]});
  await assert.rejects(f.access.resolveCommercialActionAccess("target","A","quotations","quotation.create"));
  assert.equal(f.state.audit.length,2);assert.equal(f.state.locks.length,6);
});
for(const [name,change] of [
  ["no administrator capability",f=>{f.state.memberships[0].permissions.commercialActions=[];}],
  ["global role is not membership",f=>{f.state.memberships[0].businessId="B";}],
  ["disabled actor",f=>{f.state.user.isDisabled=true;}],
  ["inactive business",f=>{f.state.businesses[0].status="suspended";}],
  ["foreign target",f=>{f.state.memberships[1].businessId="B";}],
  ["missing target",f=>{f.input.targetUserId="missing";}],
  ["unknown action",f=>{f.input.actions=["quotation.invalid"];}],
  ["unregistered module",f=>{f.input.modules=["erp_sales"];}],
  ["cannot delegate absent authority",f=>{f.state.memberships[0].permissions.commercialActions=["commercial.permissions.manage"];}],
  ["ineligible target role",f=>{f.input.actions=["invoice.issue"];f.input.modules=["finance"];}],
  ["business module cap",f=>{f.state.businesses[0].settings={moduleAccess:{customized:true,enabled:["quotations"]}};f.input.modules=["finance"];f.input.actions=[];}],
  ["empty audit reason",f=>{f.input.reason=" ";}],
  ["malformed target policy",f=>{f.state.memberships[1].permissions=[];}],
  ["self escalation",f=>{f.input.targetUserId="actor";f.state.memberships[0].permissions.commercialActions=["commercial.permissions.manage"];f.input.actions=["commercial.permissions.manage","quotation.create"];}],
])test(`commercial grant denied: ${name}`,async()=>{
  const f=grantFixture();change(f);
  await assert.rejects(f.grants.setCommercialPermissions(f.input));
  assert.deepEqual(f.state.writes,[]);assert.deepEqual(f.state.audit,[]);
});
test("grant audit failure rolls back permission changes",async()=>{
  const f=grantFixture();f.state.failAudit=true;
  await assert.rejects(f.grants.setCommercialPermissions(f.input),/audit failed/);
  assert.equal(f.state.memberships[1].permissions.commercialActions,undefined);
  assert.deepEqual(f.state.audit,[]);
});
test("supplied grant transaction is used without root transaction",async()=>{
  const f=grantFixture();const tx={...f.db};f.db.$transaction=()=>assert.fail("root transaction forbidden");
  await f.grants.setCommercialPermissions(f.input,tx);
  assert.equal(f.state.audit.length,1);
});
test("module-only legacy writer preserves commercial grants and uses version predicate",async()=>{
  const stamp=new Date();let data;
  const db={businessMember:{findUnique:async()=>({id:"m",role:"owner",updatedAt:stamp,permissions:{commercialActions:["quotation.read"],custom:{keep:true}}}),update:async args=>{assert.equal(args.where.updatedAt,stamp);data=args.data;return {...args.data,role:"owner"};}}};
  const load=loader(db,{auditStub:async()=>{}});
  await load("services/permissions.service.ts").setMemberModules({actorUserId:"actor",businessId:"A",userId:"target",modules:["finance"]});
  assert.deepEqual(Array.from(data.permissions.commercialActions),["quotation.read"]);
  assert.equal(data.permissions.custom.keep,true);
});
function billingFixture() {
  const f=commercialRequestFixture();
  Object.assign(f.state.businesses[0],{isDemo:false,portalKind:"customer",isLocked:false,isTrial:false,plan:"professional",planStatus:"active",licenseStatus:"active",trialStartDate:null,trialEndsAt:null,subscriptionEndsAt:new Date("2099-01-01")});
  f.db.business.findUnique=async ({where})=>f.state.businesses.find(b=>b.id===where.id)||null;
  f.billing=f.load("services/commercial-billing-access.service.ts");
  f.billingGuard=f.load("middleware/requireCommercialBillingAccess.ts").requireCommercialBillingAccess("quotations","quotation.create");
  f.ctx={userId:"actor",businessId:"A",role:"owner",permissions:f.state.memberships[0].permissions};
  return f;
}
test("read-only billing allows a coherent active subscription with zero writes",async()=>{
  const f=billingFixture();assert.equal((await f.billing.evaluateCommercialBillingAccess(f.ctx)).allowed,true);
  assert.deepEqual(f.state.writes,[]);
});
test("read-only billing allows a stored valid trial without normalization",async()=>{
  const f=billingFixture();Object.assign(f.state.businesses[0],{isTrial:true,plan:"trial",planStatus:"trial",licenseStatus:"trial",trialStartDate:new Date("2026-01-01"),trialEndsAt:new Date("2026-01-05")});
  assert.equal((await f.billing.evaluateCommercialBillingAccess(f.ctx,undefined,new Date("2026-01-03"))).allowed,true);
  assert.deepEqual(f.state.writes,[]);
});
for(const [name,patch] of [
  ["locked",{isLocked:true}],["deleted",{status:"deleted"}],["suspended",{status:"suspended"}],
  ["missing paid expiry",{subscriptionEndsAt:null}],["expired subscription",{subscriptionEndsAt:new Date("2000-01-01")}],
  ["past due",{planStatus:"past_due"}],["cancelled",{planStatus:"cancelled"}],
  ["unknown plan",{plan:"future-plan"}],["unknown status",{planStatus:"mystery"}],
  ["demo",{isDemo:true,portalKind:"demo"}],["inconsistent paid trial",{isTrial:true}],
  ["expired license",{licenseStatus:"expired"}],
  ["malformed expiry",{subscriptionEndsAt:new Date("invalid")}],
])test(`billing fails closed: ${name}`,async()=>{
  const f=billingFixture();Object.assign(f.state.businesses[0],patch);
  try{assert.equal((await f.billing.evaluateCommercialBillingAccess(f.ctx)).allowed,false);}catch(e){assert.equal(e.code,"COMMERCIAL_ACCESS_DENIED");}
  assert.deepEqual(f.state.writes,[]);
});
test("billing rejects missing/disabled/foreign membership without global-role bypass",async()=>{
  for(const change of [f=>{f.state.memberships=[];},f=>{f.state.user.isDisabled=true;},f=>{f.state.memberships[0].businessId="B";}]){
    const f=billingFixture();change(f);await assert.rejects(f.billing.evaluateCommercialBillingAccess(f.ctx));assert.deepEqual(f.state.writes,[]);
  }
});
test("billing actual middleware chain requires a pin, allows eligible request and rejects revocation",async()=>{
  const f=billingFixture();await f.billingGuard(f.req,f.res,()=>assert.fail("no pin"));assert.equal(f.res.statusCode,403);
  let calls=0;f.res.statusCode=200;
  await f.guard(f.req,f.res,()=>f.billingGuard(f.req,f.res,()=>{calls++;}));assert.equal(calls,1);
  await f.guard(f.req,f.res,async()=>{
    f.state.memberships[0].permissions.commercialActions=[];
    await f.billingGuard(f.req,f.res,()=>assert.fail("revoked grant"));
  });assert.equal(f.res.statusCode,403);assert.deepEqual(f.state.writes,[]);
});
test("billing uses supplied transaction reads and rejects revoked transaction membership",async()=>{
  const f=billingFixture();const tx={...f.db,businessMember:{findUnique:async()=>null}};
  await assert.rejects(f.billing.evaluateCommercialBillingAccess(f.ctx,tx));assert.deepEqual(f.state.reads,[]);
});
test("new billing contains no legacy repair or update dependencies",()=>{
  for(const file of ["services/commercial-billing-access.service.ts","middleware/requireCommercialBillingAccess.ts"]){
    const source=fs.readFileSync(path.join(root,"apps/api/src",file),"utf8");
    assert.doesNotMatch(source,/getUserBusinessId|normalizeStandardTrial|enforceLockIfNeeded|publishSubscriptionChange|\.update\(/);
  }
});

test("finance does not gain quotation writing or approval through explicit grants",async()=>{
  const f=authFixture();f.state.memberships[0].role="finance";
  f.state.memberships[0].permissions={modules:["quotations"],commercialActions:["quotation.create","quotation.approve","quotation.read"]};
  await f.access.resolveCommercialActionAccess("actor","A","quotations","quotation.read");
  for(const action of ["quotation.create","quotation.approve"])await assert.rejects(f.access.resolveCommercialActionAccess("actor","A","quotations",action));
});
test("manager scope includes managed peers only after active exact-business filtering",async()=>{
  const f=commercialRequestFixture();f.state.memberships[0].role="sales_manager";
  let checks=[];
  f.db.team={findMany:async()=>[]};
  f.db.teamMember={findMany:async ({where})=>where.userId?[{teamId:"team"}]:[{userId:"peer-A"},{userId:"peer-B"},{userId:"disabled"}]};
  f.db.businessMember.findMany=async ({where})=>{checks.push(where);return [{userId:"actor"},{userId:"peer-A"}];};
  const context=await f.access.resolveCommercialActionAccess("actor","A","quotations","quotation.create");
  const scope=await f.access.buildCommercialReferenceScope(context);
  assert.equal(checks[0].businessId,"A");assert.equal(checks[0].user.isDisabled,false);
  assert.deepEqual(Array.from(scope.contactWhere.OR[1].assignedTo.in),["actor","peer-A"]);
  assert.deepEqual(Array.from(scope.dealWhere.userId.in),["actor","peer-A"]);
  assert.equal(JSON.stringify(scope).includes("peer-B"),false);
  assert.equal(JSON.stringify(scope).includes("disabled"),false);
});
test("disabled target grants denied but revocation remains available",async()=>{
  const f=grantFixture();const original=f.db.businessMember.findUnique;
  f.db.businessMember.findUnique=async args=>{const result=await original(args);if(result&&args.where.businessId_userId.userId==="target")result.user={isDisabled:true};return result;};
  await assert.rejects(f.grants.setCommercialPermissions(f.input));
  f.state.memberships[1].permissions={modules:["quotations"],commercialActions:["quotation.read"]};
  await f.grants.setCommercialPermissions({...f.input,actions:[],modules:[]});
  assert.equal(f.state.audit.length,1);
});
test("role/capability revoked before locked reads rejects grant without update",async()=>{
  const f=grantFixture();const original=f.db.$queryRawUnsafe;
  f.db.$queryRawUnsafe=async (...args)=>{
    const result=await original(...args);
    if(args[0].includes("BusinessMember"))f.state.memberships[0].permissions.commercialActions=[];
    return result;
  };
  await assert.rejects(f.grants.setCommercialPermissions(f.input));assert.deepEqual(f.state.writes,[]);
});
test("stale target write aborts grant without misleading audit",async()=>{
  const f=grantFixture();f.db.businessMember.update=async()=>{throw Error("stale write");};
  await assert.rejects(f.grants.setCommercialPermissions(f.input),/stale write/);
  assert.deepEqual(f.state.audit,[]);assert.equal(f.state.memberships[1].permissions.commercialActions,undefined);
});
test("module-only stale JSON snapshot cannot overwrite new commercial grants",async()=>{
  const before={modules:["finance"],commercialActions:["quotation.read"]};const stamp=new Date();
  const db={businessMember:{findUnique:async()=>({id:"m",role:"owner",updatedAt:stamp,permissions:before}),update:async ({where})=>{
    assert.equal(where.permissions.equals,before);
    // PostgreSQL's extended unique predicate does not match the changed JSON.
    throw Error("concurrent permission change");
  }}};
  const load=loader(db,{auditStub:async()=>assert.fail("failed update must not audit success")});
  await assert.rejects(load("services/permissions.service.ts").setMemberModules({actorUserId:"actor",businessId:"A",userId:"target",modules:["finance"]}),/concurrent permission change/);
});
test("read-only billing uses coherent transaction snapshot without root fallback",async()=>{
  const f=billingFixture();const tx={...f.db};
  f.db.business={findUnique:async()=>assert.fail("root billing forbidden")};
  tx.business={findUnique:async()=>f.state.businesses[0]};
  assert.equal((await f.billing.evaluateCommercialBillingAccess(f.ctx,tx)).allowed,true);
});
test("billing middleware returns explicit denial for expired pinned business",async()=>{
  const f=billingFixture();f.state.businesses[0].subscriptionEndsAt=new Date("2000-01-01");
  await f.guard(f.req,f.res,()=>f.billingGuard(f.req,f.res,()=>assert.fail("expired subscription")));
  assert.equal(f.res.statusCode,402);assert.equal(f.res.body.code,"COMMERCIAL_BILLING_DENIED");assert.deepEqual(f.state.writes,[]);
});

test("grant administration cannot give sales Finance module even without operational actions",async()=>{
  const f=grantFixture();await assert.rejects(f.grants.setCommercialPermissions({...f.input,actions:[],modules:["finance"]}));
  assert.deepEqual(f.state.writes,[]);
});
test("legacy module editor preserves dedicated quotations module without granting it by default",async()=>{
  for(const existing of [[],["quotations"]]){
    let updated;const old={modules:existing,commercialActions:["quotation.read"]};
    const db={businessMember:{findUnique:async()=>({id:"m",role:"owner",updatedAt:new Date(),permissions:old}),update:async ({data})=>{updated=data.permissions;return {role:"owner"};}}};
    await loader(db,{auditStub:async()=>{}})("services/permissions.service.ts").setMemberModules({actorUserId:"actor",businessId:"A",userId:"target",modules:["finance"]});
    assert.equal(updated.modules.includes("quotations"),existing.includes("quotations"));
    assert.deepEqual(Array.from(updated.commercialActions),["quotation.read"]);
  }
});

test("stale combined module/role edit cannot synchronize global role before rejection",async()=>{
  const db={user:{update:async()=>assert.fail("global role must not change")},businessMember:{findUnique:async()=>({id:"m",role:"owner",updatedAt:new Date(),permissions:{modules:["finance"],commercialActions:[]}}),update:async()=>{throw Error("stale permission snapshot");}}};
  await assert.rejects(loader(db,{auditStub:async()=>assert.fail("no success audit")})("services/permissions.service.ts").setMemberModules({actorUserId:"actor",businessId:"A",userId:"target",modules:["finance"],role:"finance"}),/stale permission snapshot/);
});

test("action reference validation uses one supplied transaction for membership, customer and deal",async()=>{
  const f=commercialRequestFixture();const calls=[];
  const tx={businessMember:{findUnique:async args=>{calls.push("member");return f.db.businessMember.findUnique(args);}},
    contact:{findFirst:async ({where})=>{calls.push("contact");assert.equal(where.businessId,"A");return {id:"cA"};}},
    deal:{findFirst:async ({where})=>{calls.push("deal");assert.equal(where.businessId,"A");return {id:"dA",contactId:"cA"};}}};
  f.db.contact.findFirst=()=>assert.fail("root customer read");f.db.deal.findFirst=()=>assert.fail("root deal read");
  const result=await f.access.assertCommercialReferences("actor","A",{contactId:"cA",dealId:"dA"},"quotations",tx,"quotation.create");
  assert.equal(result.context.businessId,"A");assert.deepEqual(calls,["member","contact","deal"]);assert.deepEqual(f.state.writes,[]);
});

test("transaction reference validation rejects a foreign customer even with a valid action grant",async()=>{
  const f=commercialRequestFixture();const tx={...f.db};
  await assert.rejects(f.access.assertCommercialReferences("actor","A",{contactId:"cB"},"quotations",tx,"quotation.create"));
  assert.deepEqual(f.state.writes,[]);
});

test("billing rejects disagreement with the real request pin before any read",async()=>{
  const f=billingFixture();
  await f.context.runWithStrictBusinessContext({...f.ctx,businessId:"B"},async()=>{
    await assert.rejects(f.billing.evaluateCommercialBillingAccess(f.ctx));
  });
  assert.deepEqual(f.state.reads,[]);assert.deepEqual(f.state.writes,[]);
});

test("actor disabled between commercial and billing gates cannot proceed",async()=>{
  const f=billingFixture();
  await f.guard(f.req,f.res,async()=>{
    f.state.user.isDisabled=true;
    await f.billingGuard(f.req,f.res,()=>assert.fail("disabled actor proceeded"));
  });
  assert.equal(f.res.statusCode,403);assert.deepEqual(f.state.writes,[]);
});

test("permission manager cannot revoke an action beyond its explicit authority",async()=>{
  const f=grantFixture();
  f.state.memberships[1].permissions={modules:["quotations"],commercialActions:["quotation.read"]};
  f.state.memberships[0].permissions.commercialActions=f.state.memberships[0].permissions.commercialActions.filter(a=>a!=="quotation.read");
  await assert.rejects(f.grants.setCommercialPermissions({...f.input,actions:[],modules:["quotations"]}));
  assert.deepEqual(f.state.writes,[]);assert.deepEqual(f.state.audit,[]);
});

test("billing denies exact expiry and invalid trial chronology without modifying stored dates",async()=>{
  for(const trial of [false,true]){
    const f=billingFixture();const now=new Date("2026-10-10T00:00:00Z");
    Object.assign(f.state.businesses[0],trial?{isTrial:true,plan:"trial",planStatus:"trial",licenseStatus:"trial",trialStartDate:new Date("2026-10-11"),trialEndsAt:new Date("2026-10-12")}:{subscriptionEndsAt:now});
    const before=JSON.stringify(f.state.businesses);
    assert.equal((await f.billing.evaluateCommercialBillingAccess(f.ctx,undefined,now)).allowed,false);
    assert.equal(JSON.stringify(f.state.businesses),before);assert.deepEqual(f.state.writes,[]);
  }
});
