# Phase C migration review checkpoint — not implementation

These files are proposals only. Neither runtime schema nor prisma/migrations is
modified. No database commands have executed. Review both the Prisma additions
and SQL-specific constraints/triggers before approving draft/API implementation.
The actual SQL has not been tested against PostgreSQL. No concurrency claim.

## Contents and scope

- schema.prisma.proposed: eight additive models. No legacy reverse relations,
  permission grants, backfills, Finance changes or conversion table.
- migration.sql.proposed: corresponding tables, tenant-composite foreign keys,
  uniqueness, numeric/state checks and append-only/sent-content guards.
- schema.diff: exact append-only proposed change against the current dirty schema.

Items belong to immutable pricing snapshots, so every material draft edit creates
a new snapshot and new items; it never destroys a previous item's calculation.
Approval history binds to that exact snapshot, whose parent identifies the revision.
SentAt freezes content independently of subsequent expiry/withdrawal states.
Policy snapshot includes currency/timezone and exact threshold configuration/version.

All legacy business/user/contact/deal IDs are validated transactionally but are
retained as historical scalar IDs. No deletion-blocking foreign keys to legacy
tables. Deletion can leave references unresolved. New commercial-parent relations
are tenant-consistent and restrictive. Businesses/users are not cascading parents.
Composite pointer FKs prevent selecting a revision of another quotation/business.
Draft/sent pointer state consistency additionally requires transaction-bound service
checks; PostgreSQL foreign keys alone do not validate lifecycle states.

## Corrected lifecycle and immutability boundary

SQL CHECKs now enforce sent => sentAt present; draft => sentAt absent;
superseded => sentAt present; and any sentAt => currentSnapshotId present.
Expired/withdrawn revisions may retain historical sentAt (or have none if never
sent). These CHECKs do not decide whether expiry/withdrawal was authorized.
The update guard freezes all content whenever OLD.sentAt exists OR OLD.state is
not draft, and rejects return to draft. Thus clearing/changing sentAt, altering
references/terms/currency/snapshot pointers, and inconsistent historical lifecycle
fields cannot unfreeze content. Only state/approvalState/version/updatedAt changes
are exempt. Exact legal transitions, monotonic versions and approval evidence
remain service checks, not guarantees of this trigger.

Snapshot creation is atomic: insert unsealed row, insert exactly expectedItemCount
items, reconcile canonical input/output/hash, then UPDATE only sealedAt. Sealing is
the irreversible completeness boundary; older sealed snapshots reject item INSERTs
even while their revision is draft. Sealed rows/items reject UPDATE/DELETE. SQL
checks count and revision version, not semantic pricing/hash correctness. A deferred
constraint trigger prevents committing any incomplete snapshot; failure rolls back
its transaction, never leaves a resumable incomplete draft snapshot. Draft editing
always appends a NEW snapshot; no reopening, deletion or prior-snapshot amendment.
Snapshot INSERT with sealedAt already set is forbidden. New content INSERTs also
require a draft, never-sent parent. Services lock quotation -> revision -> snapshot
before inserting/sealing/sending. Item insertion locks revision and snapshot; sealing
locks the parent and validates count. Direct UPDATE can acquire snapshot first and
cause a deadlock against opposite-order writes: PostgreSQL must abort one, and the
service may retry only the entire classified transaction after revalidation.
Sending requires a sealed current snapshot matching the pre-send revision version.
Lifecycle-only later updates retain their original snapshot version. Payload changes
in the initial draft-to-sent UPDATE, terminal reactivation, version regression and
pointer eligibility remain forbidden by transaction-bound service checks.
Direct inserts of false audit/approval evidence or idempotency results are not
authenticated by these triggers. They require service authorization and database
privilege controls. Row triggers do not protect against TRUNCATE or privileged
trigger disabling/DDL; application roles must not have those privileges.
Pointer FKs enforce same quotation/revision/tenant identity, not draft/sent state,
version coherence, required pointer initialization or effective-send eligibility.
Initial sending must bind a complete snapshot and sentAt in one authorized future
transaction; Phase C exposes no sending or approval execution.

## Product scope

Existing apps/api/prisma/schema.prisma Product has required businessId, id primary
key, unique businessId/sku, isActive and deletedAt. It has no unique businessId/id
target for a tenant-composite FK. Existing ERP item FKs use Restrict/Cascade and
are not a safe deletion-neutral pattern to reuse. A validated optional scalar
productId plus immutable name/description snapshot is feasible later without a
legacy FK. A deletion-neutral optional enforced relation would require explicit
composite-key and unlink/delete design; SetNull must not null businessId or mutate
immutable history. No product model or FK is added here. Phase C's item contract
is intentionally free-text description, quantity, price and tax, not catalog-bound.

## Prisma/SQL parity inventory

All eight models map to eight tables; every scalar field is represented with the
matching nullable flag and PostgreSQL type. Cuid IDs and @updatedAt are Prisma
client behavior, NOT SQL defaults/triggers; SQL callers must provide those values.
now() maps to CURRENT_TIMESTAMP. Counter/version/state defaults match. Array and
optional object relation fields are virtual, not missing SQL columns.

There are 8 primary keys, 10 additional unique keys, 8 foreign keys and 4 indexes.
All 30 now have explicit identical Prisma map/SQL names, avoiding PostgreSQL's
automatic naming/truncation differing from Prisma-generated names. Relations:
revision->quotation; quotation->draft/sent revision; snapshot->revision;
revision->current snapshot; item/approval/event->snapshot. Every composite target
has a matching UNIQUE key in the same column order. No FK crosses into legacy
CRM, Business, User, Invoice or Product tables. Sequence/idempotency have scalar
tenant IDs and require exact-business validation in the service.

SQL-only additions: numeric/date/state/currency/position/hash/key CHECKs, lifecycle
CHECKs, append-only and revision guards, content INSERT guards, one-way sealing/count/version checks, deferred complete-at-commit
constraint trigger, initial-send sealed/version binding, and BEGIN/COMMIT.
These are NOT represented by Prisma model validation; only executing the migration
and adversarial DML against disposable PostgreSQL can validate them. Neither these
triggers nor Prisma relation validity have been executed/verified in PostgreSQL.

## Required disposable-PostgreSQL tests (not run)

1. On a fresh PostgreSQL 17 cluster as non-root, execute the proposal once; inspect
   all tables/types/defaults, 30 named keys/indexes, CHECKs/functions/triggers.
   A failing statement must roll back the DDL; a second application must fail
   visibly rather than hide mismatches with IF NOT EXISTS.
2. Reject every cross-tenant parent FK; reject a draft/sent pointer into another
   quotation and a snapshot pointer into another revision. Test nullable pointers
   during creation, then atomic initialization. Separately test service rejection
   of pointers with correct identity but incorrect state/version.
3. Reject sent/null timestamp, draft/non-null timestamp, superseded/null timestamp,
   and historical timestamp without snapshot. Preserve sentAt through sent->expired,
   withdrawn/superseded; reject clearing it, returning to draft and content edits.
   Reject edits of terminal never-sent revisions as well.
4. Reject UPDATE/DELETE on each immutable table and revision DELETE. Reject INSERT
   of snapshots/items after sending, including a two-connection insert/send race.
   Verify permitted initial draft creation and replacement draft creation preserve
   old snapshots/sent pointer. Test direct-write limitations listed above explicitly.
5. Race same-business year sequence allocations and distinct tenants; rollback
   allocated numbers; test timezone year boundary. Existing invoice sequence harness
   remains required separately. Race revision creation and stale draft updates:
   only one expected-version update succeeds, with no partial snapshots/events.
6. Race identical idempotency keys with same/different canonical requests; verify
   single committed result or 409, tenant/actor isolation and revoked replay access.
7. Inject critical audit failure and other mid-write failures; all snapshot/items,
   events, pointer/version changes, sequence updates and idempotency results roll
   back. Test lock release on commit/rollback and retry only classified conflicts.
8. Race actor disablement, membership/grant revocation, policy updates, owner/team
   changes and CRM edits/deletions against mutations; verify transaction-bound
   validation, retention and no cross-tenant authority. Never use real business data.

The SQL constraints/triggers are intentional extra protections not expressible in
the Prisma fragment. Exact schema/SQL parity and Prisma relation validity remain
validation gates before converting this proposal into an installed migration.
No invoice linkage is created; a later conversion migration will have unique
business/quotation and business/invoice links to the accepted revision.

## Approved configuration contract proposed for implementation

Read a required Business.settings.commercial configuration under the transaction's
business lock: nonempty version, explicit currency with decimalPlaces=2, explicit
valid IANA timezone, approval mode enabled/disabled. Enabled mode requires at least
one canonical decimal percentage or same-currency amount threshold. Disabled mode
must be explicit. Zero subtotal requires a named require_approval/not_required
outcome; no outcome fails closed. No configuration writer/defaults/seeds this phase.
Exact integer cross multiplication compares percentage thresholds; amounts compare
discount cents. Either strictly exceeded threshold requires approval, equality does
not. Store version and complete configuration with each snapshot. Validate hash of
the configuration too; changing values without bumping a version cannot reuse an
old approval. An approved frozen revision retains its historical policy snapshot.

## Implementation to follow review

Unmounted router/controller/service for create/list/detail/update/new-revision only.
Read access requires quotation.read. Create requires quotation.create; updates and
new revisions require quotation.update. Require customer/deal scope AND permitted
owner/team scope; active exact owner membership. No owner field patch that bypasses
these checks. Single explicit business selector, strict action and read-only billing
guards, and terminal router 404/errors. No edits to index.ts or existing routes.

Mutation transaction: lock Business and relevant Users/Members in the same stable
order as grant administration; revalidate exact membership, user/business, grants,
module, billing, policy and resource/owner scope; lock quotation/current revision
and CRM references; check expected versions; price; append snapshot/items/history;
update version predicates and pointers; write mandatory tx.auditLog; persist
idempotency response. All errors abort; critical audit is never best effort.
Customer/deal changes after validation must be protected by reference locks and
scoped predicates. Team membership changes need equivalent write-time protection.
Real database tests must establish these guarantees, not mocks.

Duplicate keys use unique business/actor/operation/key. Canonical request includes
target and expected versions, normalizes key ordering and sorts items by immutable
position; hashes reject a different request with 409. Replays reauthorize current
access before returning historical results. No standalone sequence commits or
catch-and-commit partial audit behavior. Sequence year uses configured timezone.
Creating a replacement draft leaves effectiveSentRevisionId untouched. No sending
or approval execution is available, so Phase C cannot advance to sent/approved.

## Gates and rollback

Offline pricing/foundation/strict resolution plus new transaction-client, tenant,
policy, stale-version, idempotency and audit rollback tests; API noEmit/incremental
false; Prisma relation validation; SQL parity review. Then an independently approved
disposable PostgreSQL run testing migration, triggers, cross-tenant FKs, revision
and sequence races, concurrent policy/grant changes, rollback and idempotency.
The existing Windows pg_ctl restricted-token error 87/start error 3 is unresolved;
no accessible isolated Linux runner has been established. Middleware remains
unmounted until full HTTP chain tests and separate approval.

Rollback disables/reverts only Phase C runtime artifacts. Retain populated tables,
snapshots/events and idempotency results; do not drop history, reset the dirty tree,
or roll back unrelated migrations. A shared/production migration or route mounting
requires separate review/approval. This proposal performs neither.

## Canonical content hash — mm-commercial-content-v1

Server builds a closed, versioned envelope; unknown fields are rejected, not silently
ignored. Exact top-level keys: hashVersion, businessId, quotationId, quotationNumber,
revisionId, revisionNumber, revisionVersion, ownerUserId, contactId, dealId,
issueDate, validUntil, terms, notes, currency, timezone, customerSnapshot,
policyVersion, policySnapshot, pricingVersion, canonicalInput, items, pricingOutput.
The quotationNumber/owner and all revision content used for this envelope must be
copied into the immutable snapshot envelope; historical verification never reads
mutable quotation owner metadata. canonicalInput is a wrapper with exactly
engineInput and contentEnvelope; contentEnvelope holds the top-level envelope
fields except canonicalInput itself. Reprice engineInput only.
No new commercial field may be introduced without explicitly revising this contract.
CustomerSnapshot contains the complete validated document customer identity/address/
tax/contact values defined by its versioned DTO; policySnapshot contains the entire
validated commercial policy, including currency/timezone, thresholds and zero-base
outcome. Both DTOs must reject unknown fields and define nullable/required fields
before implementation approval. Hash the full persisted values, not selected labels.
canonicalInput.engineInput contains all validated engine inputs, including quote discounts;
items contain position, description, quantity, unitPrice, taxRate, discountInput and
calculation. Stored item IDs are excluded; quantities/rates normalize to 4 decimal
places, all monetary values to 2, using exact Decimal/string arithmetic (never
Number); reject excess precision, malformed/nonfinite/negative values before
normalization. Position is a canonical unsigned decimal integer string, max 32
characters; sort by integer value (BigInt), not lexicographically; reject duplicates.
Order both canonicalInput.engineInput lines and items identically. Preserve other array order.
PricingOutput is the full calculateCommercialQuote result, including its version,
all allocations, rounded line results, aggregate totals and exact discount ratio.
Its decimal strings follow the engine's versioned output contract; ratio integers
remain canonical integer strings, never rounded display percentages.

JSON serialization: recursively sort object keys by Unicode code point; UTF-8,
no BOM/whitespace; JSON string escaping for quote/backslash/control characters;
reject lone surrogates, undefined, numeric JSON values, duplicate raw JSON keys and
non-JSON types. DTO-declared integer fields at every depth (including policy decimalPlaces) are
converted to canonical integer strings; undeclared numeric values are rejected.
Integer identifiers/versions/counts are decimal strings in the hash
envelope (stored Int fields are converted exactly). Booleans/null remain JSON values.
Text is NFC normalized with CRLF/CR converted to LF before persistence; preserve
spaces/case, no trimming. Dates are UTC ISO-8601 with exactly milliseconds and Z;
explicit null dealId is present, never interchangeable with omission. Use these
same normalized values for persistence; do not hash raw Prisma Decimal/Date objects
or database JSONB rendering. Compute lowercase hex SHA-256 of the canonical UTF-8
bytes. Persist hashVersion and contentHash, produced only by the server.

Excluded fields: snapshot/item database IDs and createdAt, sealedAt, sentAt,
revision state/approvalState, audit events, delivery metadata, quotation container
version/pointers and updatedAt. These record lifecycle/storage operations rather
than commercial content. RevisionVersion IS included: any commercial draft edit
creates a new version/snapshot/hash, never changes a previous envelope.

Before sealing, reprice canonicalInput.engineInput with the recorded supported pricingVersion;
require exact normalized equality of engine output, persisted item input/calculation
and ordered line set, expectedItemCount, customer/policy snapshots and reconstructed
hash. Before future approval/sending lock/revalidate the active revision, version,
current sealed snapshot and ownership; repeat reconciliation and hash verification.
Re-evaluate current policy for drafts/pending approvals; invalidate stale requests
transactionally. Preserve historical approved policy as separately authorized.
Sending cannot alter hashed payload in its lifecycle UPDATE, including revision
version. Use quotation container version and expected revision version for the
send conflict check; lifecycle-only updates do not increment hashed revisionVersion. Unsupported versions,
mismatch or missing fields fail closed and roll back. No client totals/hash trusted.
Idempotent replay first reauthorizes, compares the canonical request hash and verifies
the original sealed snapshot against its stored versioned envelope, not today's
changed CRM data/policy. Reconstruct mutable draft historical fields from the stored
canonical envelope (canonicalInput must include an immutable contentEnvelope copy,
excluding canonicalInput itself to avoid recursion); active-snapshot verification
additionally compares them to current revision fields. Verify envelope duplication
matches top-level fields. Different request input returns 409; corrupted historical
result fails closed. Replays perform no new mutations.

## Additional mandatory PostgreSQL/service negative tests (not executed)

| Test | Expected outcome | Enforcement |
| --- | --- | --- |
| Draft-to-sent UPDATE also changes terms/items/customer/policy | Authorized send rejects, complete rollback; direct SQL may allow payload change from OLD draft | Service hash/version validation; SQL requires sealed/version binding |
| Send locks first; edit races | Send succeeds; stale edit rejected, no new snapshots/items/events | SQL locking/content freeze + service version/state |
| Edit commits first; stale send resumes | Send rejects old version/hash; retry requires fresh authorization/pricing | Service; SQL rejects wrong snapshot version |
| Concurrent draft-pointer replacement and send | One coherent pointer/version outcome; stale operation rolls back; old effective sent pointer preserved until successful send | Composite SQL FKs + quotation lock/service predicates |
| Append to older sealed snapshot while revision remains draft | INSERT rejected; no partial item | SQL snapshot lock/sealed check |
| Insert sealed snapshot, reseal, unseal, amend/delete sealed content | All rejected | SQL |
| Missing items, wrong expected count/version at seal; commit unsealed row | Rejected/transaction rollback | SQL count/version and deferred constraint |
| Correct count but substituted positions/input/calculations; hash/output mismatch | Sealing/approval/send/replay rejects, no audit/idempotency commit | Service canonical reconciliation |
| Initial send references unsealed/wrong-version snapshot | Rejected | SQL + service |
| Item insertion versus sealing in both lock orderings | Included before seal with exact count or rejected after seal; deadlock victim rolls back wholly | SQL locks + service stable order/retry |
| Never-sent terminal or previously sent terminal reactivated; version decreased/unchanged on mutation | Service rejects; SQL alone does not enforce all transitions/version monotonicity | Service; existing SQL content freeze still applies |
| Hash key-order/decimal/text/date normalization and numeric position 2 versus 10 | Equivalent normalized inputs hash equally; material edits hash differently | Offline service tests plus stored PostgreSQL round-trip |
| Seal/audit/pointer/idempotency failure after item insertion | Entire mutation and sequence allocation rolled back; locks released | Transaction-bound service + SQL |

These are mandatory gates BEFORE implementation/activation approval; neither these
SQL changes nor concurrency are proven until an independently approved disposable
PostgreSQL run succeeds. No shared/production database may be used.
