// Offline contract for the two same-snapshot sealing lock orders.
// Does not connect to PostgreSQL, disable triggers, or treat those orders as executed.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "../../..");
const migrationRel = "apps/api/prisma/migrations/20261010140000_quotation_foundation/migration.sql";
const workflowRel = "apps/api/scripts/commercial-workflow-postgres.test.cjs";
const serviceRel = "apps/api/src/services/quotation.service.ts";
const workflowPath = path.join(root, ".github/workflows/phase-c-postgres-validation.yml");

function blob(rel) {
  return execFileSync("git", ["cat-file", "blob", `HEAD:${rel}`], { cwd: root });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sliceFunction(sql, name) {
  const marker = `CREATE FUNCTION ${name}()`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, name);
  const end = sql.indexOf("$$;", start);
  assert.notEqual(end, -1, name);
  return sql.slice(start, end);
}

const workflow = fs.readFileSync(workflowPath, "utf8");
const migration = blob(migrationRel).toString("utf8");
const service = fs.readFileSync(path.join(root, serviceRel), "utf8");
const pgTest = blob(workflowRel).toString("utf8");

test("deferred completeness rejects a committed unsealed snapshot", () => {
  assert.equal(sha256(blob(migrationRel)), "1cab80668219ca27a29956038aec18bb0d4ceac93c9b9e229f552b8edb8ab0d9");
  assert.match(workflow, new RegExp(`${sha256(blob(migrationRel))}  ${migrationRel.replaceAll("/", "\\/")}`));
  const complete = sliceFunction(migration, "mm_commercial_snapshot_complete");
  assert.match(complete, /"sealedAt" IS NULL/);
  assert.match(complete, /COMMERCIAL_SNAPSHOT_INCOMPLETE/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER mm_snapshot_complete AFTER INSERT ON "QuotationPricingSnapshot"\s+DEFERRABLE INITIALLY DEFERRED/);
  assert.equal(migration.includes("DISABLE TRIGGER"), false);
  assert.equal(migration.includes("session_replication_role"), false);
});

test("item insertion locks revision before snapshot and sealing locks snapshot before revision", () => {
  const guard = sliceFunction(migration, "mm_commercial_content_insert_guard");
  const itemBranch = guard.slice(guard.indexOf("ELSE"));
  const revisionLock = itemBranch.indexOf("FOR UPDATE OF r");
  const snapshotRead = itemBranch.indexOf('SELECT "sealedAt"');
  const snapshotLock = itemBranch.indexOf("FOR UPDATE;", snapshotRead);
  assert.ok(revisionLock >= 0 && snapshotRead > revisionLock && snapshotLock > snapshotRead);
  assert.match(itemBranch, /COMMERCIAL_SNAPSHOT_SEALED/);
  const seal = sliceFunction(migration, "mm_commercial_snapshot_seal_guard");
  const rejectSealed = seal.search(/OLD\."sealedAt" IS NOT NULL OR NEW\."sealedAt" IS NULL/);
  const revisionAfterReject = seal.indexOf("FOR UPDATE");
  assert.ok(rejectSealed >= 0 && revisionAfterReject > rejectSealed);
  assert.match(seal, /COMMERCIAL_HISTORY_IMMUTABLE/);
});

test("application inserts and seals one snapshot before the transaction commits", () => {
  const snapStart = service.indexOf("async function snapshot(");
  const snapEnd = service.indexOf("export async function createQuotation");
  const snapshot = service.slice(snapStart, snapEnd);
  const items = snapshot.indexOf("quotationRevisionItem.createMany");
  const seal = snapshot.indexOf("quotationPricingSnapshot.update");
  assert.ok(items >= 0 && seal > items);
  assert.match(snapshot.slice(seal, seal + 220), /sealedAt:new Date\(\)/);
  const editStart = service.indexOf("export async function editQuotationDraft");
  const editEnd = service.indexOf("export async function getQuotation");
  const edit = service.slice(editStart, editEnd);
  const heldRevision = edit.indexOf('FROM "QuotationRevision"');
  const snapshotCall = edit.lastIndexOf("await snapshot(");
  assert.ok(heldRevision >= 0 && snapshotCall > heldRevision);
  assert.match(edit, /FOR UPDATE/);
});

test("runtime evidence still names both same-snapshot lock orders unverified", () => {
  assert.match(workflow, /Exact competing same-snapshot trigger-lock orderings: UNVERIFIED/);
  assert.equal(workflow.includes("trigger-lock orderings: VERIFIED"), false);
  assert.equal(sha256(blob(workflowRel)), "8173a54c14948cfcaa2d9f348860bf42a00c714f0bbdb981870696552288a1b5");
  assert.equal(pgTest.includes("DISABLE TRIGGER"), false);
  assert.equal(pgTest.includes("session_replication_role"), false);
  assert.match(pgTest, /for\(const sealFirst of \[false,true\]\)test\(`independent insertion cannot see uncommitted snapshot \(\$\{sealFirst\?"sealed":"not yet sealed"\}\); original trigger-lock scenario remains UNVERIFIED`/);
});
