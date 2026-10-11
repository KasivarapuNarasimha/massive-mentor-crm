// Offline only: transpile source in memory; never load the app, Prisma, env or network.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../../..");
const ts = createRequire(path.join(root, "apps/api/package.json"))("typescript");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
function compile(source, fileName) {
  const result = ts.transpileModule(source, {
    fileName, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  });
  assert.deepEqual((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), []);
  return result.outputText;
}
function load(p, mocks, extra = "") {
  const module = { exports: {} };
  vm.runInNewContext(compile((read(p) + extra).replaceAll("import.meta.url", JSON.stringify("file:///mock/backup.service.ts")), p), {
    module, exports: module.exports,
    require(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      throw new Error("Unmocked dependency: " + id);
    },
    Buffer, console,
    setImmediate() { throw new Error("Restore work was scheduled"); },
  }, { filename: p });
  return module.exports;
}
const guard = load("apps/api/src/services/restore-safety.ts", {});
let accesses = 0;
const forbidden = new Proxy({}, { get(_target, key) { if (key === "__esModule") return true; accesses++; throw new Error("Unexpected side effect/dependency access"); } });
const bomb = () => { accesses++; throw new Error("Unexpected dependency call"); };
function service() {
  return load("apps/api/src/services/backup.service.ts", {
    "node:crypto": require("node:crypto"), "node:path": path,
    "node:zlib": require("node:zlib"), "node:util": require("node:util"),
    "node:fs": forbidden, "node:fs/promises": forbidden,
    "../lib/prisma.js": { prisma: forbidden }, "../config/env.js": { env: forbidden },
    "./audit.service.js": { recordAudit: bomb }, "./email.service.js": { sendEmail: bomb },
    "./restore-safety.js": guard
  }, "\nexports.testWorkers = { restoreBusinessData, restoreFullData };");
}
function controllers(backup = forbidden) {
  return load("apps/api/src/controllers/backup.controller.ts", {
    "node:fs": { createReadStream: () => ({ pipe: res => { res.streamed = true; } }) },
    "../services/backup.service.js": backup,
    "../services/business.service.js": { resolveTenantContext: bomb },
    "../services/tenant-scope.service.js": { resolveActorRole: bomb },
    "../services/restore-safety.js": guard
  });
}
const request = body => ({ user: { id: "user", email: "test@example.invalid", role: "admin" },
  body, params: { id: "backup", restoreId: "existing-pending" }, query: {}, headers: {}, ip: null });
function response() { return { statusCode: 200, status(n) { this.statusCode = n; return this; },
  json(value) { this.body = value; return this; }, setHeader() {} }; }
function disabled(res) {
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, "RESTORE_TEMPORARILY_DISABLED");
  assert.equal(res.body.message, guard.RESTORE_DISABLED_MESSAGE);
}
for (const scope of ["business", "full"]) {
  test(scope + " service request and pending confirmation perform zero dependency accesses", async () => {
    accesses = 0;
    const api = service();
    await assert.rejects(api.requestRestore({ backupId: "backup", actorUserId: "user", scope,
      businessId: "other-tenant", confirmPhrase: "RESTORE PLATFORM" }), e => e.code === guard.RESTORE_DISABLED_CODE);
    await assert.rejects(api.confirmRestore({ restoreId: "existing-pending", actorUserId: "user",
      confirmationToken: "previous-token" }), e => e.code === guard.RESTORE_DISABLED_CODE);
    assert.equal(accesses, 0);
  });
}
test("private workers reject business/full/cross-tenant payloads before data or progress access", async () => {
  accesses = 0;
  const api = service();
  await assert.rejects(api.testWorkers.restoreBusinessData("tenant-b", forbidden, bomb),
    e => e.code === guard.RESTORE_DISABLED_CODE);
  await assert.rejects(api.testWorkers.restoreFullData(forbidden, bomb),
    e => e.code === guard.RESTORE_DISABLED_CODE);
  assert.equal(accesses, 0);
});
test("all four controller entry points fail closed, including dry-run flags and cross-tenant IDs", async () => {
  accesses = 0;
  const ctrl = controllers();
  for (const name of ["platformRequestRestore", "platformConfirmRestore", "tenantRequestRestore", "tenantConfirmRestore"]) {
    const res = response();
    await ctrl[name](request({ scope: "full", businessId: "other-tenant", dryRun: true,
      confirmationToken: "previous-token", confirmPhrase: "RESTORE PLATFORM" }), res);
    disabled(res);
  }
  assert.equal(accesses, 0);
});
test("direct registered API restore routes cannot bypass controller guard", async () => {
  accesses = 0;
  const ctrl = controllers();
  const noop = () => {};
  for (const file of ["backup.routes.ts", "platform.routes.ts"]) {
    const routes = [];
    const router = {};
    for (const method of ["get", "post", "patch", "put", "delete"])
      router[method] = (url, ...handlers) => routes.push({ method, url, handlers });
    const other = new Proxy({}, { get: () => noop });
    load("apps/api/src/routes/" + file, {
      express: { Router: () => router },
      "../middleware/auth.js": { requireAuth: noop, requirePlatformAdmin: noop },
      "../controllers/backup.controller.js": ctrl,
      "../controllers/platform.controller.js": other,
      "../controllers/auth.controller.js": other,
      "../middleware/rateLimiter.js": other
    });
    const targets = routes.filter(r => r.method === "post" &&
      (r.url.includes("backups/") && r.url.endsWith("/restore") ||
       r.url === "/:id/restore" || r.url.includes("/restores/")));
    assert.equal(targets.length, 2, file);
    for (const route of targets) {
      const res = response();
      await route.handlers.at(-1)(request({ businessId: "other-tenant", confirmationToken: "old" }), res);
      disabled(res);
    }
  }
  assert.equal(accesses, 0);
});
test("legacy report restore is blocked without calling its dependencies", async () => {
  accesses = 0;
  const ctrl = load("apps/api/src/controllers/report.controller.ts", {
    "../services/report.service.js": forbidden, "../services/restore-safety.js": guard
  });
  const res = response();
  await ctrl.restoreDb(request({}), res);
  disabled(res);
  assert.equal(accesses, 0);
});
test("platform create/list/metadata/download/verify handlers remain callable", async () => {
  const calls = [];
  const record = { id: "backup", sizeBytes: 1n };
  const ctrl = controllers({
    createBackup: async opts => { calls.push(["create", opts.type]); return record; },
    listBackups: async () => { calls.push(["list"]); return [record]; },
    getBackup: async () => { calls.push(["get"]); return record; },
    getBackupFilePath: async () => { calls.push(["download"]); return { fileName: "fixture.mmbak", abs: "mock-only" }; },
    verifyBackup: async () => { calls.push(["verify"]); return { ok: true, detail: "mock-only" }; }
  });
  for (const type of ["business", "full"]) {
    const res = response();
    await ctrl.platformCreateBackup(request({ type, businessId: "business" }), res);
    assert.equal(res.statusCode, 202);
  }
  for (const name of ["platformListBackups", "platformGetBackup", "platformVerifyBackup", "platformDownloadBackup"]) {
    const res = response();
    await ctrl[name](request({}), res);
    assert.equal(res.statusCode, 200);
    if (name === "platformDownloadBackup") assert.equal(res.streamed, true);
    else assert.equal(res.body.success, true);
  }
  assert.deepEqual(calls.map(c => c[0]), ["create", "create", "list", "get", "verify", "download"]);
});
function functions(source) {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  return new Map(file.statements.filter(ts.isFunctionDeclaration).map(n =>
    [n.name.text, n.getText(file).replace(/\r\n/g, "\n")]));
}
// Only these owner-authorized, behavior-preserving lint edits are permitted.
// Keep every other token and every protected function under exact comparison.
function expectedPreservedFunction(p, name, text) {
  if (p !== "apps/api/src/controllers/report.controller.ts") return text;
  if (name === "getDashboardReports" || name === "backupDb") {
    return text.replace("catch (error: unknown)", "catch");
  }
  if (name === "attachmentDisposition") {
    return text.replace(String.raw`/[^\w.\-]+/g`, String.raw`/[^\w.-]+/g`);
  }
  return text;
}

test("preservation exception cannot allow unrelated implementation changes", () => {
  const p = "apps/api/src/controllers/report.controller.ts";
  const source = 'function backupDb() { try { writeOriginal(); } catch (error: unknown) { failOriginal(); } }';
  const expected = expectedPreservedFunction(p, "backupDb", source);
  assert.equal(expected, source.replace("catch (error: unknown)", "catch"));
  assert.notEqual(expected, expected.replace("writeOriginal()", "writeOther()"));
  assert.notEqual(expected, expected.replace("failOriginal()", "returnSuccess()"));
  assert.equal(expectedPreservedFunction(p, "restoreDb", source), source);
  assert.equal(expectedPreservedFunction("other.ts", "backupDb", source), source);
});

test("all non-restore service/controller functions are unchanged except exact authorized lint edits", () => {
  for (const p of ["apps/api/src/services/backup.service.ts", "apps/api/src/controllers/backup.controller.ts",
    "apps/api/src/controllers/report.controller.ts"]) {
    const before = functions(execFileSync("git", ["show", "HEAD:" + p], { cwd: root, encoding: "utf8" }));
    const after = functions(read(p));
    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), p + ":function inventory");
    const changed = new Set(["requestRestore", "confirmRestore", "restoreBusinessData", "restoreFullData",
      "platformRequestRestore", "platformConfirmRestore", "tenantRequestRestore", "tenantConfirmRestore", "restoreDb"]);
    for (const [name, text] of before) if (!changed.has(name)) assert.equal(after.get(name), expectedPreservedFunction(p, name, text), p + ":" + name);
  }
});
test("frontend restore controls are disabled and maintenance notice is visible", () => {
  for (const p of ["apps/web/app/admin/backups/page.tsx", "apps/web/app/dashboard/backups/page.tsx"]) {
    const source = read(p);
    compile(source, p);
    assert.ok(source.includes("Restore temporarily disabled for safety maintenance."));
    const file = ts.createSourceFile(p, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let count = 0;
    function visit(node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "button") {
        const attrs = node.openingElement.attributes.properties;
        const click = attrs.find(a => a.name?.getText(file) === "onClick");
        if (click && /restore/i.test(click.getText(file))) {
          count++;
          const disabled = attrs.find(a => a.name?.getText(file) === "disabled");
          assert.ok(disabled && !disabled.initializer, "Restore must be unconditionally disabled: " + p);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    assert.equal(count, p.includes("/admin/") ? 3 : 2);
  }
});
