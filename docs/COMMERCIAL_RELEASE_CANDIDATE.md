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
