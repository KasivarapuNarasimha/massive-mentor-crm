# Commercial Phase 1 foundation

Scope: opt-in foundation only. No quotation models/routes/UI, payment gateway,
financial data changes, schema changes, API contract changes or deployment.

## Before this patch

Local branch main, HEAD 2e947addd88c9175879991aee3e993c82b2ca85e.
27 tracked dirty paths (25 modified, two backup deletions), plus substantial
untracked user/safety work. Local working tree is not a production baseline.
All existing dirty work is preserved. Environment/backup contents were not read.

## Files and integration contracts

- src/services/commercial-access.service.ts (new): explicit business ID validated
  against the exact BusinessMember, enabled User and active Business. Roles reuse
  existing Finance/ERP write roles; modules reuse existing template/business
  policies, with malformed/empty customized policies denied. Global user/platform
  role never grants authority. Existing request pin must agree. Contact/deal checks
  require strict business scope and a matching customer relationship; null-business
  and deleted customers are excluded. Functions perform SELECTs only, no repairs.
  This is an internal service, not a new API. Future routes must bind validated
  context and revalidate authority/references at transactional write time; these
  read-only prechecks alone are not a write-time concurrency guarantee.
- src/lib/commercial-money.ts (new): parseCommercialDecimal accepts plain decimal
  strings only (unsigned, no leading zeros except zero itself). JavaScript numbers
  and Decimal objects are rejected at this input boundary; computed Decimal values
  are serialized internally without Number conversion before storage validation.
  Money Decimal(18,2), quantity Decimal(18,4), rate Decimal(8,4). Rejects malformed,
  missing, negative, non-finite, excess non-zero precision and storage overflow.
  All numeric inputs require strings, including zero and small values. Quantity positivity is enforced in pricing.
  No currency/comma stripping, exponent strings or silent invalid-to-zero behavior.
  Tax-rate storage maximum is NOT a GST policy or approved tax limit.
- src/services/commercial-pricing.service.ts (new): pure positive-quantity,
  nonnegative-price base line math and aggregate totals; tax rate must be explicit
  (use "0" for no tax). Half-up line/tax rounding, matching ERP normal valid cases.
  Local 40-digit Decimal constructor avoids intermediate double rounding on large
  products without mutating global Decimal settings. All computed totals are checked
  against storage limits. Discounts and inclusive/component GST are intentionally
  deferred pending business-policy approval.
- src/services/invoice-sequence.service.ts (modified): customer numbering accepts
  optional Prisma.TransactionClient. Without it, existing one-argument behavior is
  preserved. With it, advisory lock and sequence read/create/update use that client,
  without opening a nested/root transaction. Caller owns commit/rollback/retry.
  INV-YYYY-00001 format, namespace, stored prefix, widening after 99999 and current
  calendar-year convention remain unchanged. SaaS/platform functions unchanged.
- scripts/commercial-foundation.test.cjs (new): node:test, VM/transpilation loader
  consistent with existing safety tests. Real policy/math/sequence source, mocked
  database I/O, and a legacy-resolver trap. Existing private ERP recalcTotals is
  extracted and executed for regression comparisons. No services or real DB start.

## Compatibility boundary / outstanding risks

No existing endpoint uses these new helpers yet. Legacy assertFinanceAccess,
assertErpAccess, toDecimal and their current callers retain repair/fallback and
permissive parsing behavior. Fixing those caller chains changes API behavior and
requires a separately approved patch. Current CRM Won/sales-order paid-invoice and
synthetic-payment semantics remain unchanged. Existing customer invoice/payment
records, SaaS billing/activation, pricing services and migrations are untouched.

The new explicit workspace helper validates any caller-proposed target against
membership; it does not trust a client ID or choose a workspace heuristically.
No new sales-role commercial permissions are introduced. Customer/deal read checks
must be repeated/enforced alongside future scoped writes; no stock/invoice
transaction integration has been implemented here.

Offline sequence tests verify lock order, use of the supplied client and simulated
rollback, not PostgreSQL lock/Serializable behavior. A disposable PostgreSQL test
is required before integrating atomic invoice issuance. Current schema declarations
are tested, but production schema/constraint installation is not verified.

## Checks / review

Run from repository root, with existing dependencies:

    node --test apps/api/scripts/commercial-foundation.test.cjs
    node --test apps/api/scripts/strict-business-resolution.test.cjs
    node apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit --incremental false
    git diff --check -- apps/api/src/services/invoice-sequence.service.ts

Existing strict-resolver tests reuse the lead-assignment fixture without
starting application services. No install, build, Prisma generate,
API startup, migration, production connection or database-writing test is needed.

Review only these six patch files. Do not copy/stage unrelated dirty files. Before
Phase 2, approve commercial role/workspace policy, tax/discount/rounding conventions,
and the separate existing-API integration changes; then plan schema and transaction
integration in isolation. Do not automatically advance to Phase 2.

## Original Phase 1 executed results

- commercial-foundation.test.cjs: 74 passed, 0 failed.
- strict-business-resolution.test.cjs: 16 passed, 0 failed.
- API TypeScript --noEmit --incremental false: passed.
- Customer sequence diff whitespace and new-file trailing-whitespace checks: passed.
- Pre-existing file size/mtime/source-hash preservation: verified except the one
  intentionally modified customer invoice-sequence file.
- SaaS/platform sequence function bodies: unchanged from HEAD.
- PostgreSQL runtime/concurrency, HTTP integration and production checks: not run.

## Phase 1 corrective contracts

resolveCommercialAccess(userId, businessId, module, transaction?) and
assertCommercialReferences(userId, businessId, input, module, transaction?) use
that exact Prisma.TransactionClient for every membership/customer/deal read.
Omitting it is READ-ONLY PREFLIGHT only. Future mutations must call these inside
an actual caller-owned transaction with its callback client, then use exact
business-scoped write predicates. This does not itself prevent TOCTOU races:
choose locking/version predicates or Serializable with whole-transaction retry;
validate that policy against disposable PostgreSQL before invoice issuance.
No existing endpoint uses the commercial parser/pricing helpers. Their legacy
number inputs and permissive parser remain unchanged. The JSON amount
90071992547409.91 becomes 90071992547409.90 before Decimal sees it; all numbers
are now rejected, and the string retains the exact amount.

### Strict commercial HTTP boundary integration design (guard now implemented, unmounted)

Current index.ts mounts global requireBillingAccess before route requireAuth and
requireModuleFromPath. The former can repair business state; the latter's legacy
fallback can repair membership. A route-level guard after them is insufficient.
Do not mount quotation routes beneath that chain without an explicitly approved
integration patch. No existing route/middleware behavior changes in this patch.

Smallest future boundary: explicitly mount the new commercial router BEFORE the
legacy global billing middleware, with requireAuth, an explicit-workspace strict
commercial guard, a read-only tenant-bound billing gate, then controller/service.
The guard must require a single explicit workspace identifier, treat it only as
an untrusted selector, validate exact membership/user/business/module via
resolveCommercialAccess, reject an existing request/ALS pin disagreement, freeze
req.strictBusinessContext and invoke next through runWithStrictBusinessContext.
Never invoke getUserBusinessId, generic requireModuleFromPath, provisioning or
repair. No global/platform role bypass. Billing must retain existing entitlement
restrictions for the same validated business but use SELECTs only; do not reuse
evaluateBillingAccess/enforceLockIfNeeded until a read-only variant is approved.
Ensure terminal commercial-router 404/error handling cannot fall through to the
legacy middleware. Controller gets business only from the validated pin; service
revalidates within its write transaction. Auth session touch is separate from
membership/business authorization repair and must be assessed at integration.
Request tests must cover absent/disabled/foreign memberships, module/billing
denials, pin mismatch, concurrent request isolation, and zero repair writes.
This design requires no schema change but HTTP integration remains a prerequisite
before quotation routes; the new guard is operational in focused middleware tests but not mounted in the application.

## Corrective patch validation

- Commercial foundation plus strict-business-resolution offline tests: 98 passed, 0 failed.
- New coverage: numeric/Decimal input rejection, canonical exact strings, JSON cents
  loss, numeric pricing fields, supplied-client reads, foreign references and denied
  transaction authority without root-client fallback.
- No PostgreSQL concurrency or HTTP router integration test was performed.

## Strict HTTP guard prerequisite

requireCommercialAccess(module, action) is now implemented but NOT mounted.
It requires requireAuth first, exactly one x-business-id selector, exact enabled
membership/active business, an explicit permissions.modules entry, and an exact
permissions.commercialActions string grant. Missing/malformed/wildcard grants
fail closed. Existing role/module/business policy restrictions still apply.
No grants, seeds, defaults, endpoints, or existing route changes are introduced.
commercialActions is an opt-in JSON contract, not an approved role-to-action
mapping: approve the action catalog/grant administration and sales-team roles
before enabling quotation handlers. Sales users remain denied by the current
Finance/ERP write-role restriction until that separate policy change is approved.
Request/tenant/ALS disagreement fails closed; frozen validated context is bound
through existing AsyncLocalStorage. Body/query business IDs cannot grant authority.
Future handlers pass context.userId/businessId and their actual transaction client
to resolveCommercialActionAccess and assertCommercialReferences; revalidate both
at write time and use tenant-scoped mutations/concurrency safeguards.
The guard performs SELECT-only authorization and cannot invoke repair fallback.
It does NOT implement subscription entitlement policy. Mount future commercial
router outside legacy global gates as described above, with a tenant-bound
read-only billing check and terminal 404/error handling before live integration.

### Guard validation and disposable PostgreSQL harness

    node --test apps/api/scripts/commercial-foundation.test.cjs apps/api/scripts/strict-business-resolution.test.cjs
    node apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit --incremental false
    node apps/api/scripts/commercial-sequence-postgres.test.cjs

The harness uses existing PostgreSQL 17 binaries (override MM_TEST_PG_BIN if
needed), creates its own OS-temp cluster and synthetic database, listens on
127.0.0.1 with an ephemeral port, and overrides Prisma's connection URL explicitly.
It never reads .env or uses the existing PostgreSQL service. Local trust auth is
limited to this disposable cluster; no existing security settings are changed.
It tests the ACTUAL allocator against a minimal synthetic InvoiceSequence table:
20 simultaneous allocations, tenant separation, outer transaction rollback for
existing/new sequences, lock contention and release after commit/rollback.
It stops only its own new instance and retains synthetic files/logs for review.
No project migration, schema push, generate, seed or app startup is used.

Current execution: 125 offline tests passed. PostgreSQL initdb succeeded, but
pg_ctl start failed with "could not create restricted token: error code 87" /
"could not start server: error code 3". No concurrency tests ran. Re-run the
harness once normal disposable process startup works; do not elevate/bypass
sandbox controls or point it at any existing database. This minimal fixture does
not validate real Invoice foreign keys, production schema, full issuance
idempotency or Serializable retry behavior; those remain later integration tests.

Final guard API no-emit/no-incremental TypeScript check: passed. Whitespace
checks: passed. 675 unrelated non-secret source paths matched pre-edit hashes.

## Commercial policy/grants/read-only billing prerequisite (unmounted)

New runtime files: services/commercial-policy.ts,
services/commercial-permissions.service.ts,
services/commercial-billing-access.service.ts and
middleware/requireCommercialBillingAccess.ts. Existing commercial access/guard
and focused tests are extended; permissions.service.ts has ONLY preservation and
optimistic-concurrency hunks over its existing unrelated work.

The 13 registered action names are an eligibility ceiling, never default grants.
Quotations and commercial administration require the dedicated "quotations"
module; customer invoice/payment actions require "finance". ERP is not an alias.
The private additive module is outside legacy MODULE_CATALOG/templates, avoiding
accidental default grants to all CEO/admin templates. Future catalog/UI addition
must preserve that no-default rule; current legacy module UI cannot administer it.
Sales Executive: explicit read/create/update/send only, assigned contacts and own
deals. Sales Manager: those actions plus approval, own/managed-team references,
filtered through active exact-business memberships; no unassigned-business pool.
Finance: quotation read and invoice/payment actions, explicit grants required.
Owner/admin/business_admin/ceo: eligible operational and administration actions,
with separate explicit grants. Generic manager/global platform role is not an
alias. Acceptance recording is registered but DENIED pending recorder/evidence
policy approval. Actual discount approval records/self-approval/version checks
remain for quotation implementation; none are fabricated in this prerequisite.

setCommercialPermissions accepts exact actor/business/target IDs, registered
actions and commercial modules, and a reason. It uses a caller transaction or
opens one, locks business/user/member rows in stable order, revalidates administrator
membership/capability, checks exact target, role ceilings, business module caps,
and the actor's explicit authority over every changed action/module. Self-additions
and grants to disabled targets are denied; revocation remains available.
It preserves all unrelated JSON fields/modules. Update and BEFORE/AFTER audit
are in the same transaction and audit failure aborts it. It never uses the
best-effort audit helper. Caller-owned transactions must propagate errors and
roll back; no catch-and-commit. No root repairs or global User.role changes.

Legacy setMemberModules preserves commercialActions/other JSON, retains any
existing dedicated quotations module, and checks both updatedAt and exact prior
JSON in its write predicate. It cannot introduce quotations through legacy
module editing. Concurrent stale edits now fail rather than overwrite grants;
clients must reload/retry. No existing route mounting/authorization changes.

Initial administrator grants are NOT bootstrapped: role alone cannot establish
administration. Approve an independently authenticated, tenant-bound initial
provisioning procedure before enabling grant administration. Also approve the
action catalog's role ceiling, generic-manager mapping, acceptance recorder,
discount/self-approval limits, and a policy-management service before enabling
quotation operations. commercial.policy.manage is authorization only here;
there is no new policy-settings endpoint or implementation.

New billing evaluator/middleware use the existing pin and exact membership.
Only SELECTs; no workspace selection, repairs, trial normalization, invented
expiry, lock update, realtime publication or platform override. A coherent
active paid record with valid future expiry/active license, or a coherent stored
unexpired trial, is allowed. Locked/inactive/deleted/cancelled/expired states deny.
Missing paid expiry, past_due/grace, demo exemption, unknown plans/status,
inconsistent trial/paid/license flags fail closed as BILLING_POLICY_UNRESOLVED.
These ambiguous cases require entitlement approval, not inference from legacy
self-healing behavior. The legacy billing evaluator is unchanged.

Future chain: requireAuth -> per-route strict commercial action guard -> matching
commercial billing middleware -> controller -> same-transaction action/reference
revalidation -> strictly business-scoped writes. Mount only in a separate namespace
before legacy billing with terminal 404/errors. No routes are mounted now.
For sales resource checks supply the action argument to assertCommercialReferences;
without it the legacy foundation preflight write-role restriction remains.

Focused offline tests cover grants/revocation, self-escalation, target isolation,
role/action eligibility, assigned/team scope, JSON preservation, revoked/stale
state, transactional audit rollback and SELECT-only billing/pinned middleware.
Mocks do not prove PostgreSQL row-lock/Serializable behavior. The disposable
PostgreSQL harness was NOT rerun in this phase; concurrency remains pending after
its previously recorded restricted-token startup failure.

Final prerequisite checks: 190 offline tests passed (foundation + strict resolver);
API TypeScript --noEmit --incremental false passed; whitespace passed. 675
unrelated source paths matched pre-edit hashes. No real DB tests in this phase.
Stale module/role updates reject before legacy global-role synchronization, so the
new permission precondition cannot leave that synchronization as a partial write.
Successful legacy role/module behavior is retained; unrelated setter work is preserved.
