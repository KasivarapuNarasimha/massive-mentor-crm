// Offline: real strict resolver and real historical resolver functions, mocked DB only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const { fixture } = require("./lead-assignment-safety.test.cjs");
const root = path.resolve(__dirname, "../../..");
const ts = createRequire(path.join(root, "apps/api/package.json"))("typescript");

function setup() {
  const f = fixture("owner", { realStrictResolver: true });
  for (const b of f.state.business) Object.assign(b, {
    ownerUserId: "actor", isDemo: false, portalKind: "customer",
    plan: "trial", planStatus: "trial", isTrial: true,
    createdAt: new Date("2026-01-01")
  });
  for (const m of f.state.businessMember) m.createdAt = new Date("2026-01-01");
  f.state.businessMember = f.state.businessMember.filter(m =>
    !(m.userId === "actor" && m.businessId === "B"));
  f.repairs = [];
  for (const method of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
    f.db.businessMember[method] = async () => {
      f.repairs.push(method); throw new Error("Membership write forbidden: " + method);
    };
  }
  return f;
}
function noWrites(f) {
  assert.deepEqual(f.repairs, []);
  assert.deepEqual(f.state.writes, []);
  assert.equal(f.state.reclamations, 0);
  assert.equal(f.state.legacyResolutions || 0, 0);
  assert.equal(f.state.audits.length, 0);
}
// Extract actual function declarations to avoid importing application startup/env.
// The function bodies and their dynamic dependency chain are not mocked.
function legacyChain(f) {
  const cache = new Map();
  function load(file, names) {
    if (cache.has(file)) return cache.get(file);
    const text = fs.readFileSync(path.join(root, "apps/api/src/services", file + ".ts"), "utf8");
    const source = ts.createSourceFile(file + ".ts", text, ts.ScriptTarget.Latest, true);
    const functions = source.statements.filter(n =>
      ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
    assert.equal(functions.length, names.length);
    const code = 'import { prisma } from "../lib/prisma.js";\n' +
      functions.map(n => n.getText(source)).join("\n");
    const built = ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    });
    const module = { exports: {} };
    cache.set(file, module.exports);
    vm.runInNewContext(built.outputText, {
      module, exports: module.exports, console: { info() {}, error() {} },
      getStrictRequestContext: f.load("strict-request-context.service").getStrictRequestContext,
      require(id) {
        if (id === "../lib/prisma.js") return { prisma: f.db };
        if (id === "./business.service.js")
          return load("business.service", ["customerWorkspaceWhere", "resolveExistingCustomerBusiness"]);
        throw new Error("Unexpected resolver dependency: " + id);
      }
    });
    return module.exports;
  }
  return load("field-engine.service", ["getUserBusinessId"]);
}

test("real legacy dependency chain reaches repair; real strict chain rejects the same owner fixture", async () => {
  const legacy = setup();
  legacy.state.businessMember = legacy.state.businessMember.filter(m => m.userId !== "actor");
  await legacyChain(legacy).getUserBusinessId("actor");
  assert.deepEqual(legacy.repairs, ["upsert"]); // Positive control: old bug is not mocked away.
  assert.deepEqual(legacy.state.writes, []); // Trap prevents even mock repair mutation.
  const strict = setup();
  strict.state.businessMember = strict.state.businessMember.filter(m => m.userId !== "actor");
  await assert.rejects(strict.tenant.resolveLeadWriteContext("actor"), /workspace required/);
  noWrites(strict);
});

test("owner with existing active membership resolves through real strict dependency without writes", async () => {
  const f = setup();
  const context = await f.tenant.resolveLeadWriteContext("actor");
  assert.equal(context.businessId, "A"); assert.equal(context.role, "owner");
  noWrites(f);
});

test("foreign membership/global admin cannot authorize a target business mutation", async () => {
  const f = setup();
  f.state.user.find(u => u.id === "foreign").platformRole = "super_admin";
  f.state.user.find(u => u.id === "foreign").role = "admin";
  const context = await f.tenant.resolveLeadWriteContext("foreign");
  assert.equal(context.businessId, "B"); assert.equal(context.role, "sales_executive");
  f.add("tenant-A", null, "A");
  await assert.rejects(f.crm.updateContact("foreign", "tenant-A", { assignedTo: "foreign" }), /not found/i);
  noWrites(f);
});

test("disabled actor fails through real resolver without writes", async () => {
  const f = setup(); f.state.user.find(u => u.id === "actor").isDisabled = true;
  await assert.rejects(f.tenant.resolveLeadWriteContext("actor"), /Active membership/);
  noWrites(f);
});

for (const status of ["suspended", "deleted"]) {
  test("real strict context rejects " + status + " business without writes", async () => {
    const f = setup(); f.state.business[0].status = status;
    await assert.rejects(f.tenant.resolveLeadWriteContext("actor"), /Active membership/);
    noWrites(f);
  });
}

test("membership disappearing between selection and validation fails without repair", async () => {
  const f = setup(); const findFirst = f.db.businessMember.findFirst.bind(f.db.businessMember);
  f.db.businessMember.findFirst = async opts => {
    if (opts.where.userId === "actor") return null;
    return findFirst(opts);
  };
  await assert.rejects(f.tenant.resolveLeadWriteContext("actor"), /Active membership/);
  noWrites(f);
});

test("multiple memberships: counts, paid preference, age and stable ID determine selection without writes", async () => {
  const f = setup();
  f.state.businessMember.push({
    id: "actor-B", userId: "actor", businessId: "B", role: "manager",
    createdAt: new Date("2026-01-01")
  });
  // Reverse input to prove tie-break independence from database row order.
  f.state.businessMember.reverse();
  assert.equal((await f.tenant.resolveLeadWriteContext("actor")).businessId, "A");
  Object.assign(f.state.business[1], { plan: "pro", planStatus: "active", isTrial: false });
  assert.equal((await f.tenant.resolveLeadWriteContext("actor")).businessId, "B");
  f.add("A-contact");
  assert.equal((await f.tenant.resolveLeadWriteContext("actor")).businessId, "A");
  f.add("B-contact", null, "B");
  Object.assign(f.state.business[1], { plan: "trial", planStatus: "trial", isTrial: true });
  f.state.businessMember.find(m => m.id === "actor-B").createdAt = new Date("2025-01-01");
  assert.equal((await f.tenant.resolveLeadWriteContext("actor")).businessId, "B");
  noWrites(f);
});

test("inactive highest-ranked membership fails closed instead of silently redirecting writes", async () => {
  const f = setup();
  f.state.businessMember.push({
    id: "actor-B", userId: "actor", businessId: "B", role: "owner",
    createdAt: new Date("2026-01-01")
  });
  f.state.business[0].status = "suspended"; f.add("A-contact");
  await assert.rejects(f.tenant.resolveLeadWriteContext("actor"), /Active membership/);
  noWrites(f);
});

test("demo selection remains membership-only and read-only", async () => {
  const f = setup();
  Object.assign(f.state.business[1], { isDemo: true, portalKind: "demo" });
  f.state.businessMember.push({
    id: "actor-B", userId: "actor", businessId: "B", role: "owner",
    createdAt: new Date("2026-01-01")
  });
  f.add("demo-contact", null, "B");
  assert.equal((await f.tenant.resolveLeadWriteContext("actor")).businessId, "B");
  f.add("customer-contact");
  assert.equal((await f.tenant.resolveLeadWriteContext("actor")).businessId, "A");
  noWrites(f);
});

test("assignment preview/member GET lookup execute real strict resolution with zero writes", async () => {
  const f = setup(); f.add("lead");
  const members = await f.lead.listAssignableMembers("actor");
  assert.ok(members.some(m => m.id === "member"));
  const preview = await f.lead.smartBulkAssignLeads("actor", {
    mode: "all_members", scope: "ids", ids: ["lead"], dryRun: true
  });
  assert.equal(preview.assigned, 0); assert.equal(f.state.contact[0].assignedTo, null);
  noWrites(f);
});

test("missing membership preview/member lookup/contact/assignment fail before any repair or mutation", async () => {
  for (const operation of ["members", "preview", "contact", "assignment"]) {
    const f = setup(); f.add("lead");
    f.state.businessMember = f.state.businessMember.filter(m => m.userId !== "actor");
    const run = {
      members: () => f.lead.listAssignableMembers("actor"),
      preview: () => f.lead.smartBulkAssignLeads("actor", {
        mode: "all_members", scope: "ids", ids: ["lead"], dryRun: true
      }),
      contact: () => f.crm.createContact("actor", { name: "lead", assignedTo: "member" }),
      assignment: () => f.lead.smartBulkAssignLeads("actor", {
        mode: "single", scope: "ids", ids: ["lead"], assignedTo: "member"
      })
    };
    await assert.rejects(run[operation](), /workspace required/);
    noWrites(f);
  }
});

test("valid contact and assignment writes do not perform resolver-side membership repair", async () => {
  const f = setup();
  const contact = await f.crm.createContact("actor", { name: "new", assignedTo: "member" });
  assert.equal(contact.businessId, "A");
  f.add("unassigned");
  const result = await f.lead.smartBulkAssignLeads("actor", {
    mode: "single", scope: "ids", ids: ["unassigned"], assignedTo: "member"
  });
  assert.equal(result.assigned, 1);
  assert.deepEqual(f.repairs, []);
  assert.equal(f.state.reclamations, 0);
  assert.equal(f.state.legacyResolutions || 0, 0);
  assert.ok(f.state.writes.every(w =>
    ["contact", "leadAssignmentBatch", "leadAssignmentLine", "leadAssignmentItem"].includes(w.model)));
});

test("strict resolver permits only read operations and has no legacy repair dependencies", () => {
  const file = path.join(root, "apps/api/src/services/strict-business-resolution.service.ts");
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const reads = [];
  function visit(n) {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        ts.isPropertyAccessExpression(n.expression.expression) &&
        n.expression.expression.expression.getText(source) === "prisma") {
      reads.push(n.expression.getText(source));
    }
    ts.forEachChild(n, visit);
  }
  visit(source);
  assert.ok(reads.length > 0);
  assert.ok(reads.every(r => ["prisma.businessMember.findMany", "prisma.contact.count"].includes(r)));
  const imports = source.statements.filter(ts.isImportDeclaration).map(n => n.moduleSpecifier.text);
  assert.deepEqual(imports, ["../lib/prisma.js"]);
});

test("history list/detail GETs reuse strict context without legacy resolution or writes", async () => {
  const f = setup();
  f.state.leadAssignmentBatch.push(
    { id: "A-batch", businessId: "A", sequence: 1, createdAt: new Date("2026-01-01"), lines: [] },
    { id: "B-batch", businessId: "B", sequence: 1, createdAt: new Date("2026-01-01"), lines: [] }
  );
  const history = await f.lead.listAssignmentHistory("actor");
  assert.equal(history.total, 1); assert.equal(history.items[0].id, "A-batch");
  assert.equal((await f.lead.getAssignmentDetail("actor", "A-batch")).id, "A-batch");
  await assert.rejects(f.lead.getAssignmentDetail("actor", "B-batch"), /Assignment not found/);
  noWrites(f);
});

test("global super-admin without exact membership cannot gain strict authority", async () => {
  const f = setup();
  Object.assign(f.state.user.find(u => u.id === "actor"), { role: "admin", platformRole: "super_admin" });
  f.state.businessMember = f.state.businessMember.filter(m => m.userId !== "actor");
  await assert.rejects(f.tenant.resolveLeadWriteContext("actor"), /workspace required/);
  noWrites(f);
});
