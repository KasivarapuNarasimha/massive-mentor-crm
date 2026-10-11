# Isolated commercial release candidate

Source checkpoints: deployed base a3938edb5553e6906d113ad5b4757cc4360bb439; commercial source b6416ba91aa5b9b530295dfe4e4fb41a3742cfee. Original worktree and production untouched.

## Reconstruction and integration

239 source paths verified against saved capture manifests (Linux LF hashes), plus exact deployed ImportBatch migration. Deployed safety post-images take precedence over earlier pre-safety capture records. The first combined test run exposed three older pre-images taking precedence; corrected crm.service, lead-assignment.service and tenant-scope.service to verified deployed post-images before final tests. All 21 safety-manifest paths are retained; index and permissions receive only additive commercial hunks. Original production Inter layout retained; no staging font/bootstrap/environment/customer assets imported. ImportBatch and Contact.importBatchId retained in merged schema and generated client. Activity migration checksum remains 9f9f76964b112ae7c149cb562812e79076bb841432c12cca63fea8c67959d91e.

Commercial new files imported from checkpoint; overlapping schema, index, Finance, ERP posting, invoice sequence, permissions, Deals/Finance UI merged as checked hunks. Strict request context retained exactly. Four legacy safety suites included unchanged except their test loader now allows the real Prisma constants dependency required by commercial permission preservation.

## Sealing scenario design decision

The requested two independent-transaction orderings require both transactions to see the same unsealed snapshot. mm_snapshot_complete is an AFTER INSERT constraint trigger, DEFERRABLE INITIALLY DEFERRED, rejecting commit while sealedAt is NULL. A snapshot starts unsealed; UPDATE permits only sealing without content changes. Thus no valid committed unsealed snapshot is available to a second transaction. Under PostgreSQL MVCC, another transaction cannot see the creator's uncommitted snapshot: its item trigger joins snapshot/revision and rejects before reaching the requested competing revision lock. After creator commit, the snapshot is sealed and item insertion rejects. Snapshot visibility tests and service send/edit lock races passed on PostgreSQL 16.15; neither substitutes for these precise lock-order scenarios.

Decision: retain atomic snapshot construction+sealing and classify the two same-visible-unsealed-snapshot races as unreachable under intact invariants, with requested execution UNVERIFIED; or separately approve a redesign allowing committed incomplete snapshots, with changed lifecycle and new concurrency tests. Do not disable triggers or fabricate an invalid committed fixture. Privileged trigger disabling is outside the supported application contract.

## Validation record

Combined offline command: node --test apps/api/scripts/{commercial-foundation,commercial-pricing,commercial-document,commercial-customer,restore-safety,lead-assignment-safety,strict-business-resolution,strict-module-authorization}.test.cjs. Actual result: 323 passed, 0 failed, 0 skipped.
Merged Prisma validation passed with a dummy nonconnecting URL. Isolated generated Prisma 6.19.3 client includes ImportBatch and commercial models. Further build/integration results are appended after execution; previous commercial-only PostgreSQL 16.15 run is not represented as merged release validation.

Real email delivery and full browser E2E remain PENDING: no approved non-production SMTP/test recipient is configured. No production secrets or database used.

## Controlled release procedure (design only; not executed)

1. Review immutable release commit/artifact hashes and reverify current deployed baseline before writes. Review ImportBatch/client and all safety preservation. Confirm policy/grants/trusted currency/timezone and dedicated commercial delivery configuration separately; never seed grants.
2. Capture a verified PostgreSQL-native recovery checkpoint and scoped previous API/Web artifacts/PM2 state. The application restore remains disabled and cannot serve as the recovery plan.
3. With separate production migration authorization, apply only 20261010140000_quotation_foundation and 20261010160000_quotation_customer_finance SQL in order, retaining their BEGIN/COMMIT semantics. Existing historical migrations must not replay; no generic deploy.sh, db push, seeds, or whole dirty-tree replacement. Verify migration recording/checksum procedure and preflight Invoice composite target uniqueness before execution.
4. Build immutable API/Web artifacts from the merged revision with existing frozen dependencies and merged generated Prisma client; no application startup during build. Preserve Inter behavior. Preserve MM_SAFE_STARTUP=1 for cutover.
5. After separate deployment approval, drain/stop only massive-mentor-api, ensure no old API/restore-capable worker serves requests, switch reviewed artifacts, start exactly one API using existing ecosystem configuration and safe startup. Switch/restart massive-mentor-web only for changed Web artifact. Do not touch massive-mentor-website or infrastructure services.
6. Verify health/readiness, process count, version/artifact identity, auth/tenant denial, RESTORE_TEMPORARILY_DISABLED, and approved synthetic commercial smoke flow. Do not mutate real customer records for tests.
7. On failure, switch scoped prior compatible artifacts and PM2 state; preserve all commercial tables/history and Finance protection triggers. Do not drop populated tables or reverse payments. A rollback API must retain strict safety and commercial Finance protections; old code without protections is not a compatible rollback target. Database recovery/PITR is a separately approved disaster operation, not automatic schema rollback.

Production migration/cutover remains prohibited until merged release and artifacts are reviewed and explicitly authorized.

## Completed merged local gates

API no-emit TypeScript and optimized build passed: 242 compiled JS files checked, zero ESM replacements. Web no-emit TypeScript before/after build and optimized build passed: 63 generated pages, original Inter preserved. Next build lint passed with existing hook/ARIA warnings. Startup callback containment test passed with zero seeds/schedulers/timers. Nineteen safety files remain exact deployed hash matches; index and permissions contain only reviewed commercial additions. Generated client includes ImportBatch and commercial models.

`pnpm --filter @massivementor/api lint` executed and exited 2: repository has ESLint 9 but no API eslint.config.js/mjs/cjs. No passing full API lint is claimed; no arbitrary replacement lint policy or new dependency was introduced.

Local build used Node 24.16.0; GitHub application integration is pinned to Node 22.16.0. Local Windows artifacts are validation artifacts, not Linux production-deployable Prisma binaries. Linux immutable release build/client and rollback-artifact validation remain production preparation gates.

## Executed merged PostgreSQL application gate

GitHub run https://github.com/KasivarapuNarasimha/massive-mentor-crm/actions/runs/38135754511 succeeded on disposable PostgreSQL 16.15. Dispatcher 8a8186eb56e914e7fe0a4998c1e2c90d776284ff checked out fixed merged runtime source 541bcc5870ccf3afde113304fd642f120be581ad, checked literal source/safety/ImportBatch hashes and fresh service provenance. Application runner applied both actual commercial migrations to its synthetic merged legacy schema (including ImportBatch), generated its Linux Prisma client, and executed 31 application integration tests: 31 pass, 0 fail, 0 skipped, harness exit 0. This was a new merged-candidate gate; the completed commercial-only PostgreSQL 16.15 proposal/catalog run was not repeated. Tests include actual HTTP tenant/grant/ownership gates, billing denials, approval, OTP, one-time unpaid conversion, payment/reversal balances, Finance protections, audit rollback, sequence locking and both service send/edit orderings. No claim is made that every legacy CRM endpoint has a database-backed test.

## Authorization-only operation template

These are reviewed operation steps, NOT executed commands and NOT production authorization. Use only a separately verified explicit production service connection, immutable Linux artifacts and recorded checkpoint paths. Never read or log connection secrets. The two SQL files already own their BEGIN/COMMIT transactions; do not wrap them with psql --single-transaction.

```sh
# AFTER authorization and read-only identity/checksum preflight:
# service alias must independently resolve to the approved production DB.
psql 'service=mm_production_reviewed' -X -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20261010140000_quotation_foundation/migration.sql
psql 'service=mm_production_reviewed' -X -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20261010160000_quotation_customer_finance/migration.sql
# Record only these applied migrations using the reviewed merged schema and
# protected connection configuration. No generic migrate-deploy fallback.
pnpm --filter @massivementor/api exec prisma migrate resolve --applied 20261010140000_quotation_foundation
pnpm --filter @massivementor/api exec prisma migrate resolve --applied 20261010160000_quotation_customer_finance
# AFTER verified artifact checkpoint/switch and separate cutover approval:
pm2 stop massive-mentor-api
# Verify no old API/restore-capable worker remains before artifact switch.
MM_SAFE_STARTUP=1 pm2 restart massive-mentor-api --update-env
# Web only after reviewed .next/artifact switch:
pm2 restart massive-mentor-web
curl --fail --silent http://127.0.0.1:4000/health
curl --fail --silent http://127.0.0.1:4000/ready
curl --fail --silent --output /dev/null http://127.0.0.1:3000/
```

No shell snippet above is self-authorizing: mm_production_reviewed is a proposed protected service alias, not an existing verified configuration. Migration resolve writes migration metadata and needs the same production authorization. Validate process metadata via sanitized projections, not pm2 environment dumps. Exact artifact switch/checkpoint paths must be finalized from the reviewed Linux release packaging; no dirty source directory replacement. Verify authenticated restore denial RESTORE_TEMPORARILY_DISABLED and authorized synthetic smoke tests without touching customer records.

Remaining gates: API ESLint configuration decision; immutable Linux API/Web release build and compatible rollback-artifact rehearsal; approved non-production SMTP recipient/configuration and real browser E2E; release/schema/configuration/grant review; separate production migration/deployment authorization. Windows builds are not represented as ready Linux deployment artifacts.
