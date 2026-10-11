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

## Release-gate continuation

API ESLint 9 now has an explicit flat configuration using the unchanged ESLint and TypeScript recommended rule sets. Four exact, already-cached development tooling dependencies were added; no runtime dependency or authorization code changed. Offline frozen installation with lifecycle scripts disabled passed; API no-emit/no-incremental TypeScript passed. Full API lint ran and found 124 errors across 39 files (51 explicit-any, 50 unused variables, 13 prefer-const, 5 useless escapes, 3 misleading character classes, 1 namespace, 1 optional-chain assertion). These errors remain unresolved; no rule was disabled and full lint is not passing. Broad legacy/runtime cleanup is not silently included in this release.

The Linux packaging script uses an explicit artifact allowlist, frozen production dependencies without lifecycle scripts, Linux Prisma generation, in-bundle symlink verification, source identity and per-file checksums. It does not start an application or access a database. Its isolated pointer-switch rehearsal preserves ImportBatch, schema, both commercial migrations and safety sources; this proves only filesystem switch/rollback mechanics. It does not substitute for a compatible prior-production-artifact rehearsal with PM2 and populated synthetic PostgreSQL history. Those remain required before production authorization.

No passed offline, PostgreSQL compatibility or integration suite was repeated for the development-tooling-only change. Real SMTP/browser validation remains pending an approved non-production transport and synthetic recipient. Current recommendation retains atomic snapshot construction/sealing; the two same-visible-unsealed-snapshot lock orderings remain UNVERIFIED, with the documented committed-unsealed prohibition making their fixtures unsupported.

## Linux packaging execution evidence

Manual packaging-only GitHub run https://github.com/KasivarapuNarasimha/massive-mentor-crm/actions/runs/38137011527 completed successfully. Dispatcher 1bf44dc8cdf6194f512002168849acefacea5be8 checked out fixed packaging source 1bc44ba (full revision in artifact record), on GitHub-hosted Ubuntu 24.04 / Node 22.16.0. The PostgreSQL job was skipped; no database, application startup or production operation ran. Both optimized Linux builds, Linux Prisma generation, frozen production dependency installation without lifecycle scripts, in-bundle symlink/environment exclusion, archive/checksum creation and isolated filesystem pointer-switch rollback assertions completed successfully. Original production Inter behavior retained. Passed offline/PG16/application suites were not repeated.

Published artifact: phase-c-linux-release-38137011527-1, ID 11701121837, 222 MB, GitHub artifact digest sha256:647a76d633eb1cdc8ad1f1b57208d960489ff016810a0cd512b892595298f563. Internal tar checksum and file/source manifest are in SHA256SUMS and RELEASE.json. This GitHub ZIP digest is distinct from the internal tar checksum. Browser download timed out; independent local archive verification is not claimed. Evidence retention is 14 days, so preserve the verified artifact before expiry through a separately reviewed retrieval step.

Two earlier packaging runs failed and published no artifact: #14 lacked a specific diagnostic; #15 identified the required-artifact check for absent Web public assets. Git confirms this source has no tracked apps/web/public directory. Corrected only that optional inclusion; compiled API/Web outputs remain mandatory. #16 passed without relaxing isolation or source checks.

The rollback check verifies only isolated atomic pointer switch/back and retained ImportBatch, migration and safety bytes. It does NOT demonstrate an exact production in-place artifact switch, PM2 process recovery, old-code compatibility with populated commercial records, or database recovery. A compatible prior artifact retaining Finance backstops and a rehearsal with synthetic populated history are still required. Do not use the pre-commercial deployed API blindly as rollback code.

Captured baseline review remains: PostgreSQL 16.15; existing ImportBatch and repaired historical migration ledger retained; apply only the two additive commercial SQL files in order, each with its own transaction, then record only those migration IDs with reviewed checksums. Preserve MM_SAFE_STARTUP=1. Drain only massive-mentor-api; switch/restart massive-mentor-web only for its changed artifact; preserve the separate website process. Verify health/ready, one API process, restore denial, source/artifact identity and authorized synthetic commercial smoke flow. This is a plan against saved baseline evidence, not fresh production verification or deployment authorization.

Production readiness: NO-GO. Remaining gates: 124 API lint violations (no rule disabled); full compatible-artifact/PM2/populated-history rollback rehearsal; approved non-production SMTP + synthetic recipient and real browser OTP flow; independent retrieval/checksum of release artifact and final deployment/configuration review. The two precise same-visible-unsealed-snapshot races remain UNVERIFIED/unreachable under the intact deferred sealing invariant. No production authorization is requested while these gates remain open.
