/**
 * Static QA for bulk leads operations (no DB required).
 * Verifies constants, route wiring, client timeouts, and UI copy.
 * Run: node scripts/qa-bulk-leads.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..", "..");
const apiSrc = join(root, "apps", "api", "src");
const webSrc = join(root, "apps", "web");

let failed = 0;
function ok(name) {
  console.log(`  PASS  ${name}`);
}
function fail(name, detail) {
  failed++;
  console.error(`  FAIL  ${name}: ${detail}`);
}
function assert(cond, name, detail = "") {
  if (cond) ok(name);
  else fail(name, detail || "assertion failed");
}

function read(rel) {
  const p = join(root, rel);
  if (!existsSync(p)) throw new Error(`missing file ${rel}`);
  return readFileSync(p, "utf8");
}

console.log("\n=== QA: Bulk Leads operations ===\n");

// --- Constants ---
console.log("1. Limits & batching");
const crm = read("apps/api/src/services/crm.service.ts");
assert(crm.includes("BULK_LEAD_MAX_ROWS = 50_000") || crm.includes("BULK_LEAD_MAX_ROWS = 50000"), "max rows = 50,000");
assert(crm.includes("BULK_LEAD_CHUNK = 1_000") || crm.includes("BULK_LEAD_CHUNK = 1000"), "chunk = 1,000");
assert(!/BULK_DELETE_MAX_IDS\s*=\s*25_000/.test(crm), "no leftover 25k max constant");
assert(crm.includes("bulkAssignLeads"), "bulkAssignLeads exported");
assert(crm.includes("lead_bulk_assign"), "audit action lead_bulk_assign");
assert(crm.includes("lead_bulk_delete"), "audit action lead_bulk_delete");
assert(crm.includes("canBulkDeleteLeads"), "delete permission gate");
assert(crm.includes("canBulkEditLeads"), "assign uses edit permission");
assert(crm.includes("No assignable leads found"), "empty target set error");
assert(crm.includes("buildCrmScope"), "tenant scope used");
// Soft-delete loop must re-query (no stale cursor on deleted rows)
assert(
  crm.includes("if (result.count === 0) break") || crm.includes("if (batchDeleted === 0) break"),
  "infinite-loop guards on batch progress"
);

// --- Routes ---
console.log("\n2. Routes & handlers");
const leadsRoutes = read("apps/api/src/routes/leads.routes.ts");
const crmRoutes = read("apps/api/src/routes/crm.routes.ts");
const controller = read("apps/api/src/controllers/crm.controller.ts");
assert(leadsRoutes.includes('"/bulk-assign"') || leadsRoutes.includes("'/bulk-assign'") || leadsRoutes.includes("/bulk-assign"), "leads.routes bulk-assign");
assert(crmRoutes.includes("bulk-assign"), "crm.routes bulk-assign");
assert(controller.includes("bulkAssignLeadsHandler"), "bulkAssignLeadsHandler");
assert(controller.includes("extendBulkRequestTimeout") || controller.includes("setTimeout"), "request timeout extended");
assert(controller.includes("first_n"), "handler accepts first_n scope");
assert(controller.includes("all_filtered"), "handler accepts all_filtered scope");

// --- Client ---
console.log("\n3. Web API client");
const apiClient = read("apps/web/lib/api.ts");
assert(apiClient.includes("bulkAssignLeads"), "api.bulkAssignLeads");
assert(apiClient.includes("bulkDeleteLeads"), "api.bulkDeleteLeads");
assert(apiClient.includes("timeoutMs: 600_000") || apiClient.includes("timeoutMs: 600000"), "600s timeout for bulk ops");
assert(apiClient.includes('scope: "ids" | "first_n" | "all_filtered"') || apiClient.includes("first_n"), "client scopes");

// --- UI ---
console.log("\n4. Leads page UI");
const page = read("apps/web/app/dashboard/leads/page.tsx");
assert(page.includes("up to 50,000") || page.includes("up to 50,000"), "delete dialog says 50,000");
assert(!page.includes("up to 25,000"), "no 25,000 copy left");
assert(page.includes('assignScope === "first_n"') || page.includes('assignScope === "first_n"'), "first_n UI");
assert(page.includes("Custom") || page.includes("custom"), "custom count UI");
assert(page.includes("all_filtered"), "all_filtered assign UI");
assert(page.includes("Assign first") || page.includes("first"), "first N messaging");
assert(page.includes("Successfully assigned"), "success messages");
assert(page.includes("BULK_ASSIGN_MAX = 50_000") || page.includes("50_000"), "client max 50k");
assert(page.includes("assignCustomValidation") || page.includes("Cannot exceed"), "custom count validation");

// --- Permission matrix (static) ---
console.log("\n5. Permission matrix (static)");
assert(crm.includes('"ceo"') && crm.includes("BULK_DELETE_ROLES"), "delete roles set");
assert(crm.includes("sales_executive"), "sales_executive in edit roles path");
assert(crm.includes("bulk_delete") || crm.includes("bulkDelete"), "optional SE bulk_delete perm");

// --- Soft-delete behavior ---
console.log("\n6. Soft-delete semantics");
assert(crm.includes("deletedAt: new Date()") || crm.includes("deletedAt: new Date()"), "sets deletedAt");
assert(crm.includes("deletedByUserId"), "sets deletedByUserId");
assert(!/hard.?delete only/i.test(crm), "soft-delete retained");

// --- Batch math ---
console.log("\n7. Batch math invariants");
const MAX = 50_000;
const CHUNK = 1_000;
assert(MAX % CHUNK === 0, "50k divisible by 1k");
assert(Math.ceil(MAX / CHUNK) === 50, "50 batches for full 50k");
assert(Math.ceil(100 / CHUNK) === 1, "100 → 1 batch");
assert(Math.ceil(1000 / CHUNK) === 1, "1000 → 1 batch");
assert(Math.ceil(1001 / CHUNK) === 2, "1001 → 2 batches");
assert(Math.ceil(10000 / CHUNK) === 10, "10k → 10 batches");

// first N resolution logic (mirror backend)
function resolveFirstN(limit, matched) {
  let lim = Math.floor(Number(limit));
  if (!Number.isFinite(lim) || lim < 1) throw new Error("invalid");
  if (lim > MAX) throw new Error("over max");
  if (lim > matched) lim = matched;
  return lim;
}
assert(resolveFirstN(1500, 38279) === 1500, "first 1500 of 38279");
assert(resolveFirstN(5000, 800) === 800, "first 5000 of 800 caps to 800");
assert(resolveFirstN(50000, 60000) === 50000, "first 50k of 60k");
try {
  resolveFirstN(0, 100);
  fail("reject limit 0", "should throw");
} catch {
  ok("reject limit 0");
}
try {
  resolveFirstN(50001, 100000);
  fail("reject limit > 50k", "should throw");
} catch {
  ok("reject limit > 50k");
}

console.log("\n=== Result ===");
if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED\n`);
  process.exit(1);
}
console.log("\nAll bulk leads QA checks passed.\n");
process.exit(0);
