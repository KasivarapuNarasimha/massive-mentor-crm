# Phase C application checkpoint

## Executed database foundation gate
GitHub-hosted disposable PostgreSQL validation run: 38057228037.
Source: ab24a13f3054d7de5618a49b8e4ac1c23e958705.
Dispatcher merged as e8c2c03635b227841c44e187431189e1b7c8e510.
The proposed eight-table migration and SQL/concurrency harness completed successfully.
The two same-snapshot sealing lock-order scenarios remain unverified. SQL tests do not establish HTTP authorization, policy freshness, hash reconciliation or real audit integration.

## Implemented, unmounted application boundary
Quotation create/list/detail/draft update/replacement revision and revision-bound approval request/approve/reject handlers are implemented. The router is deliberately unmounted. No automatic grants or business configuration are provisioned. Business.settings.commercial must explicitly provide version, two-decimal currency, IANA timezone, approval policy and any relevant zero-subtotal outcome.

Mutations use Serializable transactions, exact business membership/action checks, SELECT-only billing checks, resource and owner/team scope checks, locked authorization/reference rows, expected versions, canonical idempotency requests, server-side pricing, sealed snapshots and transaction-bound events/AuditLog writes. Self-approval is denied. Approval revalidates stored items, revision content and current policy; stale policy records an audited stale outcome. Same-key changed requests return conflict. No Finance or SaaS billing handlers were changed.

## Validation boundaries
38 new offline/synthetic HTTP tests, 180 foundation tests and 11 pricing tests passed. Synthetic rollback tests do not prove PostgreSQL application transaction behavior. Prisma schema validation and generation succeeded with an inert localhost URL; no database connection was made. API no-emit TypeScript passed.

The additive migration is prepared, not applied to any application database. Production deployment/migration requires separate authorization. Historical commercial tables must not be dropped after population during rollback.

## Remaining implementation and validation
Secure delivery/outbox, customer OTP acceptance/rejection, conversion to exactly one unpaid invoice, manual payments/reversals, balance/reporting and complete Finance compatibility guards are not implemented at this checkpoint. No claim of end-to-end completion or production readiness is made.
Application-level disposable PostgreSQL tests, the full mounted chain, concurrent updates, approval-policy changes and real audit rollback remain required before activation. The existing dispatcher pins the older source and cannot validate this new application checkpoint unchanged.

## Customer/Finance implementation (pending application PostgreSQL execution)
Added encrypted durable email deliveries, hashed 256-bit customer links, decision-bound six-digit email OTP challenges, persisted limits/expiry/attempts, retryable finalization, cancellation of queued deliveries and immutable sent-revision retention. SMTP uses a dedicated TLS-validating non-logging transport. At-least-once email delivery is possible after a transport/process crash; no exactly-once email claim is made.

Customer acceptance converts within one Serializable transaction to one Finance invoice using the existing INV format and source uniqueness. Finance `sent` is the existing Unpaid mapping; `paidAt` remains null and no synthetic payment is created. Mixed/per-line taxes remain in the commercial snapshot; legacy scalar taxRate is 0 and must not be used to recalculate this locked invoice. Existing non-cancelled Deal invoices or Sales Orders require explicit reconciliation instead of creating duplicate revenue. SaaS BillingInvoice/BillingPayment are untouched.

Manual payments use canonical decimal strings, reject overpayment and maintain append-only original/reversal entries plus the existing Payment mirror. Reversal deletes only that mirror in the same transaction and recomputes status/balance/paidAt. Historical commercial ledger entries cannot be deleted. Legacy Finance writes are denied for quotation-derived records; SQL is the write-time backstop. User deletion that would cascade-delete a commercial invoice/payment is denied rather than silently losing financial history.

New SQL-only rules: active-link partial uniqueness; tenant-consistent access-to-revision/snapshot FKs; immutable conversion/payment history; terminal lifecycle/version guards; capability-bound commercial Finance mutations and cross-path Deal finance serialization. Prisma semantic validation does not validate these triggers. The new migration is not covered by the earlier eight-table SQL run.

`Business.settings.commercialDelivery` requires explicit version, linkMinutes, otpMinutes, maxAttempts, maxResends, resendSeconds, invoiceDueDays and enabled exact invoiceIssuerUserId with Finance module + invoice.issue. No defaults or grants are provisioned. Commercial settings updates require commercial.policy.manage, expected policy version, idempotency key and audit reason; draft approvals are marked stale transactionally. Sent snapshots retain their approved policy.

Runtime configuration names: COMMERCIAL_PUBLIC_URL (HTTPS Web origin), COMMERCIAL_DELIVERY_KEY (32-byte base64 AES-GCM/HMAC key), and existing SMTP_HOST/PORT/USER/PASS/FROM (465 or 587, certificate validation enabled). Provision values through the approved environment mechanism, never source control. Retain old encryption keys until queued messages are drained or explicitly cancelled; changing the active key invalidates outstanding OTP hashes and ciphertext. No customer gateway integration is added.

Prepared HTTP routers remain unmounted until actual application PostgreSQL/HTTP tests pass. New public Web page is /quotation/[token], with no-store API requests, no-referrer and noindex. Customer pages do not receive JWTs, OTP hashes or delivery ciphertext. Quotation creation/editing/approval/sending and Finance payment/report operations use dedicated APIs, not legacy repair-capable gates.

## Disposable application test execution
`apps/api/scripts/commercial-application-run.sh` accepts only trusted GitHub-hosted service/run metadata, reuses the reviewed storage provenance checks, creates a fresh run-specific database and generates legacy DDL into runner temp from the schema prefix. It applies only the two new commercial migrations to that disposable baseline. It does not apply production/shared migrations, start the application, seed subscriptions or send external messages. The service/HTTP harness uses real Prisma/database transactions and actual middleware, JWT signature verification and a synthetic SMTP adapter.

The two independent same-snapshot tests verify rejection while the snapshot is uncommitted and rejection after sealing commits. They do NOT prove the originally requested competing revision-lock orderings: the deferred incomplete-snapshot rule prevents sharing an unsealed committed snapshot. Those exact lock-order scenarios remain UNVERIFIED; no assertions are weakened to claim a pass.

## Deployment gate / rollback
Repository architecture: deploy/ecosystem.config.cjs runs massive-mentor-api from apps/api/dist/index.js on 4000 and massive-mentor-web via next start on 3000; deploy/nginx.conf is the reverse proxy. deploy/deploy.sh is prohibited for this release because migrate deploy falls back to db push. Production schema/revision/dirty-hunk compatibility must be rechecked before any deployment. The new migrations and route activation require explicit production authorization after successful isolated application tests.

Build immutable artifacts from the reviewed safety-compatible deployment baseline, preserve the old artifact/config checkpoint, perform a reviewed additive migration without seeds/db push, and cut over under contained startup. Roll back by switching application artifacts and disabling commercial routes; retain populated commercial tables/history and Finance guards. Never reverse-drop populated history or reset the dirty production checkout. Verify strict auth failures, non-destructive quotation reads, public-link validity and unpaid invoice/payment balances with authorized synthetic tenant data only. No production deployment has occurred.
