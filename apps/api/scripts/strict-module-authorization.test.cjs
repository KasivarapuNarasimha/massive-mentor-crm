// Offline request-chain tests: actual auth/module middleware, CRM controllers,
// permissions and CRM/assignment services. DB, token verification and external
// integrations are mocked; no application startup, HTTP listener or real DB.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const { fixture } = require("./lead-assignment-safety.test.cjs");
const root = path.resolve(__dirname, "../../..");
const localRequire = createRequire(path.join(root, "apps/api/package.json"));
const ts = localRequire("typescript");

function setup() {
  const f = fixture("owner", { realStrictResolver: true });
  for (const b of f.state.business) Object.assign(b, {
    ownerUserId: "actor", isDemo: false, portalKind: "customer",
    plan: "trial", planStatus: "trial", isTrial: true, settings: {}, createdAt: new Date("2026-01-01")
  });
  for (const m of f.state.businessMember) m.createdAt = new Date("2026-01-01");
  f.state.businessMember = f.state.businessMember.filter(m =>
    !(m.userId === "actor" && m.businessId === "B"));
  f.repairs = []; f.legacyCalls = 0;
  for (const method of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
    f.db.businessMember[method] = async () => {
      f.repairs.push(method); throw new Error("Membership repair forbidden");
    };
  }
  const cache = new Map();
  const session = { bindings: {}, history: [], pending: null };
  const quiet = { info() {}, error() {}, warn() {}, log() {} };
  // Use real field-engine/business resolver function bodies as the legacy trap.
  function resolver(file, names) {
    const text = fs.readFileSync(path.join(root, "apps/api/src/services", file + ".ts"), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const nodes = sf.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
    assert.equal(nodes.length, names.length);
    return evaluate(nodes.map(n => n.getText(sf)).join("\n"), file);
  }
  function evaluate(source, file) {
    const built = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    });
    const module = { exports: {} };
    vm.runInNewContext(built.outputText, {
      module, exports: module.exports, console: quiet, Error, setTimeout, clearTimeout,
      prisma: f.db, z: localRequire("zod"),
      softRefSchema: localRequire("zod").any().optional().nullable(),
      createContact: f.crm.createContact, getContactById: f.crm.getContactById,
      normalizeStatus: value => value,
      resolveMemberRef: () => { throw new Error("Unexpected member soft-ref in fixture"); },
      getStrictRequestContext: f.load("strict-request-context.service").getStrictRequestContext,
      require(id) {
        if (id === "../lib/prisma.js") return { prisma: f.db };
        if (id === "./business.service.js")
          return resolver("business.service", ["customerWorkspaceWhere", "resolveExistingCustomerBusiness"]);
        if (id === "crypto") return require("node:crypto");
        if (id === "./permissions.js") return load("services/ai-command/permissions");
        if (id === "./executor.js") return load("services/ai-command/executor");
        if (id === "./registry.js") return load("contact-registry-fixture");
        if (id === "./planner.js") return { planFromMessage: async () => ({
          steps: [{ id: "step", action: "create_lead", args: { name: "AI lead", assignedTo: "member" } }]
        }) };
        if (id === "./session-store.js") return {
          getOrCreateSession: () => session, touchSession() {}, clearPending() {}
        };
        if (id === "./confirm-store.js") return {
          issueConfirmToken: () => "synthetic-offline-only",
          verifyConfirmToken: () => ({ ok: true, payload: { action: "create_lead", args: { name: "AI lead", assignedTo: "member" } } })
        };
        if (id === "../services/ai-command/service.js") return load("services/ai-command/service");
        if (id === "../middleware/aiQuota.js") return load("middleware/aiQuota");
        if (id === "../services/ai-quota.service.js") return {
          checkAiQuota: async id => ({ allowed: true, businessId: await f.field.getUserBusinessId(id) }),
          recordAiUsage: async () => {}
        };
        if (id === "../services/permissions.service.js") return f.load("permissions.service");
        if (id === "../services/tenant-scope.service.js") return f.tenant;
        if (id === "../services/strict-request-context.service.js") return f.load("strict-request-context.service");
        if (id === "../services/field-engine.service.js") return f.field;
        if (id === "../services/crm.service.js" || id === "../crm.service.js") return f.crm;
        if (id === "../services/lead-assignment.service.js") return f.lead;
        if (id === "../services/auth.service.js") return {
          verifyToken: token => ({ userId: token, portal: "customer", tv: 0 }),
          getUserById: id => f.db.user.findUnique({ where: { id } })
        };
        if (id === "../utils/ai-error.js") return { sanitizeAiUserError: e => ({ status: 400, message: e.message }) };
        if (id === "../utils/http-status.js") return {
          errorMessage: e => e.message, messageToHttpStatus: () => 400
        };
        if (id === "../permissions.service.js") return f.load("permissions.service");
        if (id === "../tenant-scope.service.js") return f.tenant;
        if (id === "../field-engine.service.js") return f.field;
        throw new Error("Unexpected request-chain dependency " + file + ": " + id);
      }
    });
    return module.exports;
  }
  const actualGetter = resolver("field-engine.service", ["getUserBusinessId"]).getUserBusinessId;
  f.field.getUserBusinessId = async id => { f.legacyCalls++; return actualGetter(id); };
  function load(relative) {
    if (relative === "contact-registry-fixture" && !cache.has(relative)) {
      const text = fs.readFileSync(path.join(root, "apps/api/src/services/ai-command/registry.ts"), "utf8");
      const sf = ts.createSourceFile("registry.ts", text, ts.ScriptTarget.Latest, true);
      const statement = sf.statements.find(n => ts.isVariableStatement(n) &&
        n.declarationList.declarations.some(d => d.name.getText(sf) === "ACTION_REGISTRY"));
      const declaration = statement.declarationList.declarations.find(d => d.name.getText(sf) === "ACTION_REGISTRY");
      const property = declaration.initializer.properties.find(p => p.name.getText(sf) === "create_lead");
      cache.set(relative, evaluate("export const ACTION_REGISTRY = {" + property.getText(sf) + "};", relative));
      return cache.get(relative);
    }
    if (!cache.has(relative)) cache.set(relative, evaluate(
      fs.readFileSync(path.join(root, "apps/api/src", relative + ".ts"), "utf8"), relative));
    return cache.get(relative);
  }
  f.auth = load("middleware/auth");
  f.middleware = load("middleware/requireModule");
  f.controller = load("controllers/crm.controller");
  f.actionPermissions = load("services/ai-command/permissions");
  f.aiQuota = load("middleware/aiQuota");
  f.aiController = load("controllers/ai-command.controller");
  f.request = (method, url, handler, body = {}, actor = "actor", afterGate) => new Promise((resolve, reject) => {
    const req = { method, originalUrl: url, path: url, headers: { authorization: "Bearer " + actor },
      body, query: {}, params: { id: "lead" }, setTimeout() {} };
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this; },
      setTimeout() {}, on() {}, json(data) { this.body = data; resolve({ req, res }); return this; } };
    f.auth.requireAuth(req, res, () => {
      Promise.resolve(f.middleware.requireModuleFromPath(req, res, () => {
        return Promise.resolve(afterGate?.(req)).then(() => handler(req, res));
      })).catch(reject);
    });
  });
  return f;
}
function noRepair(f, noDataWrites = false) {
  assert.deepEqual(f.repairs, []); assert.equal(f.state.reclamations, 0);
  if (noDataWrites) assert.deepEqual(f.state.writes, []);
}
const pass = async (_req, res) => res.json({ success: true });

test("real module middleware previously failing legacy chain is bypassed only for protected paths", async () => {
  const f = setup();
  f.state.businessMember = f.state.businessMember.filter(m => m.userId !== "actor");
  const protectedResult = await f.request("POST", "/api/crm/contacts", f.controller.createContactHandler, { name: "new" });
  assert.equal(protectedResult.res.statusCode, 403);
  assert.equal(f.legacyCalls, 0); noRepair(f, true);
  // Positive control: same real middleware's unrelated legacy branch still
  // reaches actual getUserBusinessId -> business.service upsert (trapped).
  await f.request("GET", "/api/crm/deals", pass);
  assert.ok(f.legacyCalls > 0); assert.ok(f.repairs.includes("upsert"));
  assert.deepEqual(f.state.writes, []);
});

test("active owner: real auth -> module -> controller -> contact service with zero repair", async () => {
  const f = setup();
  const result = await f.request("POST", "/api/crm/contacts", f.controller.createContactHandler, { name: "new", assignedTo: "member" });
  assert.equal(result.res.statusCode, 201);
  assert.equal(result.res.body.data.contact.businessId, "A");
  assert.equal(f.legacyCalls, 0); noRepair(f);
});

for (const kind of ["missing-member", "disabled", "suspended", "deleted", "global-admin-only"]) {
  test("protected request fails closed: " + kind, async () => {
    const f = setup();
    if (kind === "missing-member" || kind === "global-admin-only")
      f.state.businessMember = f.state.businessMember.filter(m => m.userId !== "actor");
    if (kind === "disabled") f.state.user.find(u => u.id === "actor").isDisabled = true;
    if (["suspended", "deleted"].includes(kind)) f.state.business[0].status = kind;
    if (kind === "global-admin-only") Object.assign(f.state.user.find(u => u.id === "actor"), {
      role: "admin", platformRole: "super_admin"
    });
    const result = await f.request("POST", "/api/leads/bulk-assign", f.controller.bulkAssignLeadsHandler, {
      ids: ["lead"], assignMode: "all_members", scope: "ids"
    });
    assert.ok([401, 403].includes(result.res.statusCode));
    assert.equal(f.legacyCalls, 0); noRepair(f, true);
  });
}

test("membership only in B cannot mutate target contact in A", async () => {
  const f = setup(); f.add("lead", null, "A");
  f.state.businessMember = f.state.businessMember.filter(m => m.userId !== "actor");
  f.state.businessMember.push({ id: "actor-B", userId: "actor", businessId: "B",
    role: "owner", createdAt: new Date("2026-01-01") });
  const result = await f.request("PUT", "/api/crm/contacts/lead", f.controller.updateContactHandler, { assignedTo: "foreign" });
  assert.equal(result.res.statusCode, 404, JSON.stringify(result.res.body)); noRepair(f, true);
});

test("business module OFF remains enforced even for global platform super-admin", async () => {
  const f = setup();
  f.state.user.find(u => u.id === "actor").platformRole = "super_admin";
  f.state.business[0].settings = { moduleAccess: { customized: true, enabled: ["dashboard"] } };
  const result = await f.request("POST", "/api/crm/contacts", f.controller.createContactHandler, { name: "new" });
  assert.equal(result.res.statusCode, 403); assert.equal(result.res.body.code, "MODULE_FORBIDDEN");
  noRepair(f, true);
});

test("another business's module/role grants cannot authorize current business", async () => {
  const f = setup(); f.add("lead", "actor");
  f.state.businessMember.find(m => m.id === "actor-A").permissions = {
    modules: ["dashboard"], customized: true
  };
  f.state.businessMember.push({ id: "actor-B", userId: "actor", businessId: "B",
    role: "owner", permissions: { modules: ["leads"] }, createdAt: new Date("2026-01-01") });
  const result = await f.request("GET", "/api/leads/assignable-members", f.controller.listAssignableMembersHandler);
  assert.equal(result.res.statusCode, 403); noRepair(f, true);
});

test("count changes after gate cannot move the controller/service to another workspace", async () => {
  const f = setup(); f.add("lead");
  f.state.businessMember.push({ id: "actor-B", userId: "actor", businessId: "B",
    role: "owner", createdAt: new Date("2026-01-01") });
  const result = await f.request("POST", "/api/crm/contacts", f.controller.createContactHandler,
    { name: "new" }, "actor", req => {
      assert.equal(req.strictBusinessContext.businessId, "A");
      for (let i = 0; i < 5; i++) f.add("B-" + i, null, "B");
    });
  assert.equal(result.res.statusCode, 201);
  assert.equal(result.res.body.data.contact.businessId, "A");
  assert.equal(f.legacyCalls, 0); noRepair(f);
});

test("membership revoked after gate fails in service without resolving elsewhere", async () => {
  const f = setup();
  const result = await f.request("POST", "/api/crm/contacts", f.controller.createContactHandler,
    { name: "new" }, "actor", () => {
      f.state.businessMember = f.state.businessMember.filter(m => m.id !== "actor-A");
    });
  assert.ok(result.res.statusCode >= 400); noRepair(f, true);
});

for (const prefix of ["/api/leads", "/api/crm/leads"]) {
  test(prefix + " member lookup and assignment preview are write-free", async () => {
    const f = setup(); f.add("lead");
    assert.equal((await f.request("GET", prefix + "/assignable-members",
      f.controller.listAssignableMembersHandler)).res.statusCode, 200);
    const result = await f.request("POST", prefix + "/bulk-assign", f.controller.bulkAssignLeadsHandler, {
      ids: ["lead"], assignMode: "all_members", scope: "ids", preview: true
    });
    assert.equal(result.res.statusCode, 200); assert.equal(result.res.body.data.assigned, 0);
    assert.equal(f.legacyCalls, 0); noRepair(f, true);
  });
  test(prefix + " Equal Distribution remains unassigned-only", async () => {
    const f = setup(); f.add("lead"); f.add("owned", "rival"); f.add("tenant-B", null, "B");
    const result = await f.request("POST", prefix + "/bulk-assign", f.controller.bulkAssignLeadsHandler, {
      ids: ["lead", "owned", "tenant-B"], assignMode: "all_members", scope: "ids"
    });
    assert.equal(result.res.statusCode, 200); assert.equal(result.res.body.data.assigned, 1);
    assert.equal(f.state.contact.find(c => c.id === "owned").assignedTo, "rival");
    assert.equal(f.state.contact.find(c => c.id === "tenant-B").assignedTo, null);
    noRepair(f);
  });
  test(prefix + " history list/detail GETs do not repair membership", async () => {
    const f = setup();
    f.state.leadAssignmentBatch.push({ id: "lead", businessId: "A", sequence: 1,
      createdAt: new Date("2026-01-01"), lines: [] });
    assert.equal((await f.request("GET", prefix + "/assignments", f.controller.listLeadAssignmentsHandler)).res.statusCode, 200);
    assert.equal((await f.request("GET", prefix + "/assignments/lead", f.controller.getLeadAssignmentHandler)).res.statusCode, 200);
    assert.equal(f.legacyCalls, 0); noRepair(f, true);
  });
}

test("bulk edit/delete and historical move use protected middleware", async () => {
  for (const prefix of ["/api/leads", "/api/crm/leads"]) {
    for (const action of ["bulk-edit", "bulk-delete", "move"]) {
      const f = setup(); f.add("lead", "member");
      let handler, url, body;
      if (action === "bulk-edit") {
        handler = f.controller.bulkEditLeadsHandler; url = prefix + "/bulk-edit";
        body = { ids: ["lead"], patch: { assignedTo: "rival" } };
      } else if (action === "bulk-delete") {
        handler = f.controller.bulkDeleteLeadsHandler; url = prefix + "/bulk-delete"; body = { ids: ["lead"] };
      } else {
        f.state.leadAssignmentBatch.push({ id: "lead", businessId: "A", sequence: 1 });
        f.state.leadAssignmentItem.push({ id: "item", batchId: "lead", contactId: "lead", userId: "member" });
        f.state.leadAssignmentLine.push({ id: "line", batchId: "lead", userId: "member", leadCount: 1 });
        handler = f.controller.moveLeadAssignmentHandler; url = prefix + "/assignments/lead/move";
        body = { fromUserId: "member", toUserId: "rival", count: 1 };
      }
      const result = await f.request("POST", url, handler, body);
      assert.equal(result.res.statusCode, 200, prefix + " " + action + " " + JSON.stringify(result.res.body));
      assert.equal(f.legacyCalls, 0); noRepair(f);
    }
  }
});

test("AI dispatcher gate/action context/quota getter share pin and contact lookup skips reclamation", async () => {
  for (const route of ["run", "confirm"]) {
    const f = setup(); f.add("lead");
    const result = await f.request("POST", "/api/ai-command/" + route, async (req, res) => {
      const ctx = await f.actionPermissions.buildActionContext(req.user.id);
      assert.equal(ctx.businessId, req.strictBusinessContext.businessId);
      assert.equal(ctx.role, "owner");
      // Same getter used by the quota service: actual function's pinned branch.
      assert.equal(await f.field.getUserBusinessId(req.user.id), "A");
      await f.crm.buildContactListWhere(req.user.id, { type: "lead" });
      const contact = await f.crm.createContact(req.user.id, { name: "AI lead", assignedTo: "member" });
      return res.json({ success: true, businessId: contact.businessId });
    });
    assert.equal(result.res.statusCode, 200); noRepair(f);
  }
});

test("pinned module helper rejects disagreement rather than using another business", async () => {
  const f = setup();
  const ctx = await f.tenant.resolveLeadWriteContext("actor");
  await assert.rejects(f.load("permissions.service").getMemberModuleKeys("actor", "B", ctx), /mismatch/);
  noRepair(f, true);
});

test("route scope excludes trash Undo, summaries, ERP, platform and unrelated AI", () => {
  const f = setup();
  for (const [method, url] of [
    ["POST", "/api/leads/bulk-restore"], ["GET", "/api/leads/assignment-summary"],
    ["GET", "/api/crm/contacts"], ["DELETE", "/api/crm/contacts/lead"],
    ["POST", "/api/erp/products"], ["POST", "/api/platform/businesses"],
    ["POST", "/api/ai/test"]
  ]) assert.equal(f.middleware.strictModuleForRoute(method, url), null);
});

test("request context isolates concurrent async chains and ends outside request", async () => {
  const f = setup(); const context = f.load("strict-request-context.service");
  const a = { userId: "actor", businessId: "A", role: "owner", permissions: {} };
  const b = { userId: "foreign", businessId: "B", role: "sales_executive", permissions: {} };
  await Promise.all([a, b].map(ctx => context.runWithStrictBusinessContext(ctx, async () => {
    await Promise.resolve();
    assert.equal(context.getStrictRequestContext(ctx.userId).businessId, ctx.businessId);
    assert.throws(() => context.getStrictRequestContext(ctx.userId === "actor" ? "foreign" : "actor"), /mismatch/);
  })));
  assert.equal(context.getStrictRequestContext("actor"), undefined);
});

test("AI run/confirm: real middleware, quota middleware, controller, executor and contact action", async () => {
  for (const route of ["run", "confirm"]) {
    const f = setup();
    const result = await f.request("POST", "/api/ai-command/" + route, async (req, res) => {
      await new Promise((resolve, reject) => {
        Promise.resolve(f.aiQuota.requireAiQuota("ai_command")(req, res, () =>
          Promise.resolve(f.aiController[route === "run" ? "runAiCommandHandler" : "confirmAiCommandHandler"](req, res)).then(resolve, reject)
        )).catch(reject);
      });
    }, { message: "create a lead", confirmToken: "synthetic-offline-only" });
    assert.equal(result.res.statusCode, 200);
    assert.equal(result.res.body.data.status, "completed", JSON.stringify(result.res.body));
    assert.equal(f.state.contact[0].businessId, result.req.strictBusinessContext.businessId);
    noRepair(f);
  }
});

test("case-insensitive mounted paths and trailing slash retain strict gate", async () => {
  const f = setup();
  f.state.businessMember = f.state.businessMember.filter(m => m.userId !== "actor");
  const result = await f.request("POST", "/API/CRM/contacts/", f.controller.createContactHandler, { name: "new" });
  assert.equal(result.res.statusCode, 403); assert.equal(f.legacyCalls, 0); noRepair(f, true);
});
