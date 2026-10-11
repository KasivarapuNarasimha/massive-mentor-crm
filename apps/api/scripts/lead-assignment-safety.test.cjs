// Offline unit tests: no application startup, real Prisma, environment loading or network.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../../..");
const localRequire = createRequire(path.join(root, "apps/api/package.json"));
const ts = localRequire("typescript");
const noop = async () => {};
function matches(row, where = {}) {
  if (!row) return false;
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (Array.isArray(value) ? value : [value]).every(w => matches(row, w));
    if (key === "OR") return value.some(w => matches(row, w));
    if (key === "NOT") return !matches(row, value);
    const actual = row[key];
    if (value === null || typeof value !== "object" || value instanceof Date) return actual === value;
    if ("in" in value && !value.in.includes(actual)) return false;
    if ("not" in value && actual === value.not) return false;
    if ("lt" in value && !(actual < value.lt)) return false;
    if ("gt" in value && !(actual > value.gt)) return false;
    if ("contains" in value && !String(actual || "").toLowerCase().includes(value.contains.toLowerCase())) return false;
    const operators = ["in", "not", "lt", "gt", "contains", "mode"];
    const nested = Object.fromEntries(Object.entries(value).filter(([k]) => !operators.includes(k)));
    return !Object.keys(nested).length || matches(actual, nested);
  });
}
function fixture(role = "business_admin", { realStrictResolver = false } = {}) {
  const user = id => ({ id, name: id, email: id + "@example.invalid", isDisabled: false,
    role: "sales_executive", platformRole: null, phone: null, username: null, employeeCode: null });
  const state = {
    user: ["actor", "member", "rival", "foreign", "disabled"].map(user),
    business: [{ id: "A", status: "active" }, { id: "B", status: "active" }],
    businessMember: [
      { id: "actor-A", userId: "actor", businessId: "A", role, permissions: {} },
      { id: "actor-B", userId: "actor", businessId: "B", role: "business_admin", permissions: { bulk_delete: true } },
      ...["member", "rival", "disabled"].map(id => ({ id: id + "-A", userId: id, businessId: "A", role: "sales_executive" })),
      { id: "foreign-B", userId: "foreign", businessId: "B", role: "sales_executive" }
    ],
    contact: [], leadAssignmentBatch: [], leadAssignmentLine: [], leadAssignmentItem: [],
    team: [], teamMember: [], audits: [], rollbacks: 0, writes: [], reclamations: 0
  };
  state.user.find(u => u.id === "disabled").isDisabled = true;
  function add(id, assignedTo = null, businessId = "A", userId = "actor") {
    state.contact.push({ id, assignedTo, businessId, userId, type: "lead", deletedAt: null,
      name: id, status: "new", customFields: {}, updatedAt: new Date("2026-01-01") });
  }
  let stage = null, serial = 0, hook = null, begin = null;
  const data = () => stage || state;
  function rows(model) {
    return data()[model].map(row => model === "businessMember" ? { ...row,
      user: data().user.find(u => u.id === row.userId),
      business: data().business.find(b => b.id === row.businessId)
    } : row);
  }
  const db = {};
  for (const model of ["user", "business", "businessMember", "contact", "leadAssignmentBatch",
    "leadAssignmentLine", "leadAssignmentItem", "team", "teamMember"]) {
    db[model] = {
      async findMany(opts = {}) {
        let result = rows(model).filter(r => matches(r, opts.where));
        if (opts.take !== undefined) result = result.slice(0, opts.take);
        return structuredClone(result);
      },
      async findFirst(opts = {}) { return (await this.findMany(opts))[0] || null; },
      async findUnique(opts = {}) {
        return this.findFirst(opts.where?.businessId_userId ? { ...opts, where: opts.where.businessId_userId } : opts);
      },
      async count(opts = {}) { return (await this.findMany(opts)).length; },
      async create({ data: values }) {
        const row = { id: model + "-" + (++serial), ...(model === "contact" ? { deletedAt: null } : {}), ...values };
        data()[model].push(row); data().writes.push({ model, operation: "create" });
        return structuredClone(row);
      },
      async createMany({ data: values }) {
        for (const row of values) await this.create({ data: row });
        return { count: values.length };
      },
      async updateMany({ where, data: values }) {
        if (model === "contact" && hook) hook({ state, stage, where, values });
        let count = 0;
        for (const row of data()[model]) if (matches(row, where)) { Object.assign(row, values); count++; }
        data().writes.push({ model, operation: "updateMany", where, count });
        return { count };
      },
      async update({ where, data: values }) {
        if (model === "contact" && hook) hook({ state, stage, where, values });
        const row = data()[model].find(r => matches(r, where));
        if (!row) throw new Error("Scoped record changed or not found");
        Object.assign(row, values);
        data().writes.push({ model, operation: "update", where });
        return structuredClone(row);
      },
      async delete({ where }) {
        const index = data()[model].findIndex(r => matches(r, where));
        if (index < 0) throw new Error("Scoped record not found");
        return data()[model].splice(index, 1)[0];
      }
    };
  }
  db.$transaction = async (callback, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    if (begin) { const f = begin; begin = null; f(state); }
    stage = structuredClone(state);
    try {
      const result = await callback(db);
      Object.assign(state, stage); stage = null;
      return result;
    } catch (error) { stage = null; state.rollbacks++; throw error; }
  };
  const field = {
    getUserBusinessId: async () => {
      if (realStrictResolver) {
        state.legacyResolutions = (state.legacyResolutions || 0) + 1;
        throw new Error("Legacy resolver forbidden in strict test");
      }
      return state.resolvedBusiness === undefined ? "A" : state.resolvedBusiness;
    },
    getContactFieldDefs: async () => [],
    applyContactFieldDefs: (_defs, input) => ({ core: input, customFields: input.customFields || {}, errors: [] }),
    mergeCustomFields: (a, b) => ({ ...a, ...b }),
    reclaimContactsFromDeletedBusinesses: async () => { state.reclamations++; throw new Error("Reclamation forbidden"); }
  };
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = path.join(root, "apps/api/src/services", name + ".ts");
    const source = fs.readFileSync(file, "utf8");
    const built = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
    assert.equal((built.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
    const module = { exports: {} };
    cache.set(name, module.exports);
    const mocks = {
      "../lib/prisma.js": { prisma: db },
      "./field-engine.service.js": field,
      ...(!realStrictResolver ? { "./strict-business-resolution.service.js": {
        resolveStrictBusinessId: field.getUserBusinessId
      } } : {}),
      "zod": localRequire("zod"),
      "@prisma/client": localRequire("@prisma/client"),
      "./ai.service.js": { getAIService() { throw new Error("AI forbidden"); } },
      "../utils/sanitize.js": { sanitizePromptInput: x => x },
      "./activity.service.js": { logActivity: noop, buildContactUpdateDetails: x => x },
      "../lib/lead-statuses.js": { leadStatusLabel: x => x },
      "./notification.service.js": { notifyUser: noop },
      "./followup-engine.service.js": { scheduleFollowupRefresh() {} },
      "./pagination.js": {},
      "./audit.service.js": { recordAudit: async event => state.audits.push(event) },
      "./pipeline-sync.service.js": { syncFromLeadStatusChange: async () => ({}), syncFromDealStageChange: noop },
      "../lib/money.js": { toMoneyNumber: Number }
    };
    vm.runInNewContext(built.outputText, { module, exports: module.exports, console, Error,
      require(id) {
        if (Object.hasOwn(mocks, id)) return mocks[id];
        if (id === "node:async_hooks") return require(id);
        if (["./tenant-scope.service.js", "./crm.service.js", "./lead-assignment-safety.service.js", "./strict-business-resolution.service.js", "./strict-request-context.service.js", "./permissions.service.js"].includes(id))
          return load(path.basename(id, ".js"));
        throw new Error("Unmocked dependency: " + id);
      }
    }, { filename: file });
    return module.exports;
  }
  const crm = load("crm.service");
  // Small test-only chunks let failures prove earlier chunk writes roll back.
  crm.BULK_LEAD_CHUNK = 1;
  const lead = load("lead-assignment.service");
  return { state, add, db, crm, lead, safety: load("lead-assignment-safety.service"),
    tenant: load("tenant-scope.service"), load, field, setHook: f => { hook = f; }, onBegin: f => { begin = f; } };
}
module.exports = { fixture };
function history(f, owners = ["member"]) {
  f.state.leadAssignmentBatch.push({ id: "old", businessId: "A", sequence: 1 });
  for (const [i, owner] of owners.entries()) {
    f.add("lead" + i, owner);
    f.state.leadAssignmentItem.push({ id: "item" + i, batchId: "old", contactId: "lead" + i, userId: "member" });
  }
  f.state.leadAssignmentLine.push({ id: "line", batchId: "old", userId: "member", leadCount: owners.length });
}
// Importing the fixture must not register this suite a second time.
if (require.main === module) {
test("active same-business assignee validated by user ID", async () => {
  const f = fixture(); assert.equal((await f.safety.requireActiveBusinessAssignee("A", "member")).id, "member");
});
for (const target of ["disabled", "foreign", "Display Name"]) {
  test("invalid assignee rejected: " + target, async () => {
    const f = fixture();
    await assert.rejects(f.safety.requireActiveBusinessAssignee("A", target), /active member/);
    assert.equal(f.state.writes.length, 0);
  });
}
for (const operation of ["create", "update", "bulk", "legacy", "smart"]) {
  async function invoke(f, target) {
    if (operation === "create") return f.crm.createContact("actor", { name: "new lead", assignedTo: target });
    if (operation === "update") return f.crm.updateContact("actor", "lead", { assignedTo: target });
    if (operation === "bulk") return f.crm.bulkEditLeads("actor", ["lead"], { assignedTo: target });
    if (operation === "legacy") return f.crm.bulkAssignLeads("actor", { scope: "ids", ids: ["lead"], assignedTo: target });
    return f.lead.smartBulkAssignLeads("actor", { scope: "ids", ids: ["lead"], mode: "single", assignedTo: target });
  }
  test(operation + ": valid member succeeds and invalid member cannot mutate", async () => {
    for (const target of ["disabled", "foreign"]) {
      const f = fixture(); f.add("lead");
      await assert.rejects(invoke(f, target), /active member/);
      assert.equal(f.state.contact[0].assignedTo, null);
      assert.equal(f.state.writes.length, 0);
    }
    const f = fixture(); f.add("lead"); await invoke(f, "member");
    assert.ok(f.state.contact.some(c => c.assignedTo === "member"));
  });
}
test("Sales Executive cannot borrow another business's admin role or bulk-delete permission", async () => {
  const f = fixture("sales_executive"); f.add("lead", "actor");
  assert.equal(await f.crm.canBulkDeleteLeads("actor"), false);
  await assert.rejects(f.crm.bulkSoftDeleteLeads("actor", ["lead"]), /permission/);
  assert.equal(f.state.writes.length, 0);
  f.state.businessMember.find(m => m.id === "actor-A").permissions = { bulk_delete: true };
  assert.equal(await f.crm.canBulkDeleteLeads("actor"), true);
});
test("missing business/membership, inactive business and disabled actor fail closed", async () => {
  for (const kind of ["missing-business", "missing-member", "inactive", "disabled"]) {
    const f = fixture();
    if (kind === "missing-business") f.state.resolvedBusiness = null;
    if (kind === "missing-member") f.state.businessMember = f.state.businessMember.filter(m => m.id !== "actor-A");
    if (kind === "inactive") f.state.business[0].status = "suspended";
    if (kind === "disabled") f.state.user[0].isDisabled = true;
    await assert.rejects(f.tenant.resolveLeadWriteContext("actor"), /[Aa]ctive/);
    assert.equal(f.state.writes.length, 0);
  }
});
for (const scope of ["ids", "all_filtered", "first_n", "reassign"]) {
  test("Equal Distribution " + scope + ": assigned, foreign and legacy rows stay untouched", async () => {
    const f = fixture(); f.add("free"); f.add("owned", "rival"); f.add("foreign", null, "B"); f.add("legacy", null, null);
    const result = await f.lead.smartBulkAssignLeads("actor", { scope, ids: ["free", "owned", "foreign", "legacy"],
      limit: 4, mode: "all_members", assigneeIds: ["member"], filterAssignedTo: "rival" });
    assert.equal(result.assigned, 1);
    assert.equal(f.state.contact.find(c => c.id === "owned").assignedTo, "rival");
    assert.equal(f.state.contact.find(c => c.id === "foreign").assignedTo, null);
    assert.equal(f.state.contact.find(c => c.id === "legacy").assignedTo, null);
    assert.equal(f.state.leadAssignmentItem.length, 1);
    assert.equal(f.state.reclamations, 0);
    for (const write of f.state.writes.filter(w => w.model === "contact"))
      assert.equal(matches({ id: "free", businessId: "A", userId: "actor", assignedTo: "rival", type: "lead", deletedAt: null }, write.where), false);
  });
}
test("only-assigned selected IDs cannot execute normal Equal Distribution", async () => {
  const f = fixture(); f.add("owned", "rival");
  await assert.rejects(f.lead.smartBulkAssignLeads("actor", { scope: "ids", ids: ["owned"], mode: "all_members" }), /No assignable/);
  assert.equal(f.state.writes.length, 0);
});
test("concurrent assignment in later chunk rolls back contacts and all history", async () => {
  const f = fixture(); f.add("first"); f.add("second");
  let updates = 0;
  f.setHook(({ state, stage }) => {
    if (++updates === 2) {
      state.contact.find(c => c.id === "second").assignedTo = "rival";
      stage.contact.find(c => c.id === "second").assignedTo = "rival";
    }
  });
  await assert.rejects(f.lead.smartBulkAssignLeads("actor", { scope: "ids", ids: ["first", "second"],
    mode: "all_members", assigneeIds: ["member"] }), /Assignment conflict/);
  assert.equal(f.state.contact[0].assignedTo, null);
  assert.equal(f.state.contact[1].assignedTo, "rival");
  assert.equal(f.state.leadAssignmentBatch.length, 0);
  assert.equal(f.state.leadAssignmentLine.length, 0);
  assert.equal(f.state.leadAssignmentItem.length, 0);
  assert.equal(f.state.audits.length, 0);
  assert.equal(f.state.rollbacks, 1);
});
test("filtered distribution detects assignment after candidate selection", async () => {
  const f = fixture(); f.add("lead");
  f.onBegin(state => { state.contact[0].assignedTo = "rival"; });
  await assert.rejects(f.lead.smartBulkAssignLeads("actor", { scope: "all_filtered",
    mode: "all_members", assigneeIds: ["member"] }), /Assignment conflict/);
  assert.equal(f.state.contact[0].assignedTo, "rival");
  assert.equal(f.state.leadAssignmentBatch.length, 0);
});
test("destination disabled after selection prevents assignment", async () => {
  const f = fixture(); f.add("lead");
  f.onBegin(state => { state.user.find(u => u.id === "member").isDisabled = true; });
  await assert.rejects(f.lead.smartBulkAssignLeads("actor", { scope: "ids", ids: ["lead"],
    mode: "single", assignedTo: "member" }), /active member/);
  assert.equal(f.state.contact[0].assignedTo, null);
  assert.equal(f.state.leadAssignmentBatch.length, 0);
});
test("stale historical move rolls back every chunk and history", async () => {
  const f = fixture(); history(f, ["member", "rival"]);
  await assert.rejects(f.lead.moveAssignmentLeads("actor", { batchId: "old", fromUserId: "member",
    toUserId: "actor", count: 2 }), /Stale assignment history/);
  assert.deepEqual(f.state.contact.map(c => c.assignedTo), ["member", "rival"]);
  assert.equal(f.state.leadAssignmentBatch.length, 1);
  assert.deepEqual(f.state.leadAssignmentItem.map(i => i.userId), ["member", "member"]);
  assert.equal(f.state.audits.length, 0);
});
test("valid explicit historical admin move remains functional", async () => {
  const f = fixture(); history(f);
  const result = await f.lead.moveAssignmentLeads("actor", { batchId: "old", fromUserId: "member", toUserId: "rival", count: 1 });
  assert.equal(result.assigned, 1);
  assert.equal(f.state.contact[0].assignedTo, "rival");
});
test("manager retains own/team scope and can assign eligible leads", async () => {
  const f = fixture("sales_manager"); f.add("own"); f.add("outside", null, "A", "rival");
  const result = await f.lead.smartBulkAssignLeads("actor", { scope: "ids", ids: ["own", "outside"],
    mode: "single", assignedTo: "member" });
  assert.equal(result.assigned, 1);
  assert.equal(f.state.contact.find(c => c.id === "outside").assignedTo, null);
  assert.equal(await f.crm.canBulkDeleteLeads("actor"), false);
});
test("contact update does not restore cached owner during unrelated edits", async () => {
  const f = fixture(); f.add("lead", "member");
  f.onBegin(state => { state.contact[0].assignedTo = "rival"; });
  await f.crm.updateContact("actor", "lead", { name: "renamed" });
  assert.equal(f.state.contact[0].assignedTo, "rival");
});
test("contact assignment rejects a stale expected owner", async () => {
  const f = fixture(); f.add("lead", "member");
  f.onBegin(state => { state.contact[0].assignedTo = "rival"; });
  await assert.rejects(f.crm.updateContact("actor", "lead", { assignedTo: "actor" }), /changed/);
  assert.equal(f.state.contact[0].assignedTo, "rival");
});
test("tenant A cannot update, bulk-edit, assign, delete or claim tenant B/null leads", async () => {
  for (const operation of ["update", "bulk", "assign", "delete", "filtered-delete"]) {
    const f = fixture(); f.add("foreign", null, "B"); f.add("legacy", null, null);
    if (operation === "update") await assert.rejects(f.crm.updateContact("actor", "foreign", { assignedTo: "member" }), /not found/);
    if (operation === "bulk") assert.equal((await f.crm.bulkEditLeads("actor", ["foreign", "legacy"], { assignedTo: "member" })).updated, 0);
    if (operation === "assign") await assert.rejects(f.crm.bulkAssignLeads("actor", { scope: "ids", ids: ["foreign", "legacy"], assignedTo: "member" }), /No assignable/);
    if (operation === "delete") assert.equal((await f.crm.bulkSoftDeleteLeads("actor", ["foreign", "legacy"], { permanent: true })).deleted, 0);
    if (operation === "filtered-delete") await assert.rejects(f.crm.bulkSoftDeleteLeadsByFilter("actor", {}), /No leads/);
    assert.ok(f.state.contact.every(c => c.assignedTo === null && c.deletedAt === null));
    assert.equal(f.state.reclamations, 0);
  }
});
test("historical move cannot mutate a tenant B lead referenced by tenant A history", async () => {
  const f = fixture(); history(f); f.state.contact[0].businessId = "B";
  await assert.rejects(f.lead.moveAssignmentLeads("actor", { batchId: "old", fromUserId: "member",
    toUserId: "rival", count: 1 }), /Stale assignment history/);
  assert.equal(f.state.contact[0].assignedTo, "member");
  assert.equal(f.state.leadAssignmentBatch.length, 1);
});
test("filtered explicit assignment and deletion never invoke reclamation", async () => {
  const f = fixture(); f.add("lead");
  await f.crm.bulkAssignLeads("actor", { scope: "all_filtered", assignedTo: "member" });
  await f.crm.bulkSoftDeleteLeadsByFilter("actor", {});
  assert.equal(f.state.reclamations, 0);
  assert.ok(f.state.contact[0].deletedAt);
});

test("scope is checked again when a contact changes business after selection", async () => {
  for (const operation of ["update", "bulk", "legacy", "smart"]) {
    const f = fixture(); f.add("lead");
    f.onBegin(state => { state.contact[0].businessId = "B"; });
    if (operation === "update") await assert.rejects(f.crm.updateContact("actor", "lead", { assignedTo: "member" }), /changed/);
    if (operation === "bulk") assert.equal((await f.crm.bulkEditLeads("actor", ["lead"], { assignedTo: "member" })).updated, 0);
    if (operation === "legacy") await assert.rejects(f.crm.bulkAssignLeads("actor", { scope: "ids", ids: ["lead"], assignedTo: "member" }), /Assignment conflict/);
    if (operation === "smart") await assert.rejects(f.lead.smartBulkAssignLeads("actor", { scope: "ids", ids: ["lead"], mode: "single", assignedTo: "member" }), /Assignment conflict/);
    assert.equal(f.state.contact[0].assignedTo, null);
    assert.equal(f.state.contact[0].businessId, "B");
  }
});
test("permanent delete rechecks tenant when business changes after selection", async () => {
  const f = fixture(); f.add("lead");
  const original = f.db.contact.delete;
  f.db.contact.delete = async args => { f.state.contact[0].businessId = "B"; return original(args); };
  const result = await f.crm.bulkSoftDeleteLeads("actor", ["lead"], { permanent: true });
  assert.equal(result.deleted, 0);
  assert.equal(f.state.contact.length, 1);
});
test("explicit bulk assignment rolls back earlier chunks on count mismatch", async () => {
  const f = fixture(); f.add("first"); f.add("second");
  let updates = 0;
  f.setHook(({ state, stage }) => {
    if (++updates === 2) { state.contact[1].businessId = "B"; stage.contact[1].businessId = "B"; }
  });
  await assert.rejects(f.crm.bulkAssignLeads("actor", { scope: "ids", ids: ["first", "second"], assignedTo: "member" }), /Assignment conflict/);
  assert.ok(f.state.contact.every(c => c.assignedTo === null));
  assert.equal(f.state.audits.length, 0);
});

}
