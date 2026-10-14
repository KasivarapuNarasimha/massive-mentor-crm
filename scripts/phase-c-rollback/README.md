# Phase C rollback review — execution not authorized

This PR adds CI tooling only. It does not change application code, schema, installed migrations, permissions or deployment configuration. No workflow has been merged/activated/dispatched and no SQL has run.

## Fixed identities

- Candidate: Run 38137011527, artifact 11701121837, source 1bc44ba9d9a0951645df42a853bc5799650865ef.
- Candidate ZIP SHA-256: 647a76d633eb1cdc8ad1f1b57208d960489ff016810a0cd512b892595298f563.
- Candidate tar SHA-256: 8d61dc51b6111a3ba34c5c46bed817020edfad692e3af8efd8430855da4fda26.
- Compatible fallback source to build: a8a6edafa0a85c680625cedca24b9cd700d1af61.
- Shared schema SHA-256: 3d41158267407796e07be3f57eb50aa8cd034267e91b7ad5e1211f1287bfe14e.
- PostgreSQL 16.15 amd64 manifest ec9f656f17c8b4dfebf49e58cf5c46d493d4846d4ea6d8b85d0637f68ee33bfc; config e8538db784b854a9baac5c1be6d059dcf0db257af2d94c8c5807b5fc15f11222.
- Node 22.16.0 x64; pnpm 9.15.0; PM2 6.0.8 root tarball integrity is fixed in workflow.

The fallback is a newly built commercial-compatible reference release, NOT a captured previous-production binary. Its source includes ImportBatch, startup containment, restore/billing/follow-up/tenant safety and commercial Finance backstops. Its artifact identity/compatibility is NOT verified until the Linux job builds it and passes manifest, safety-runtime, complete migration-history, PM2 and populated-data checks. Runtime fallback-source changes here are type-only/lint corrections; registry and permission runtime byte equivalence passed offline. Do not reinterpret this rehearsal as proof that the pre-commercial live binary is compatible.

## Trust and isolation

Only workflow_dispatch; no inputs or push/PR/schedule/workflow_run triggers. contents:read and actions:read only. Full-SHA actions. Main-based review branch contains only these new CI files; main is unchanged.

Authenticated API run/attempt/workflow/actor/ref/source metadata is checked before the service job. Only owner KasivarapuNarasimha, main, GitHub-hosted Ubuntu 24.04/x64 pass. The dispatcher revision must be explicitly approved before merge/dispatch. Never treat this PR as execution/deployment approval.

Image identity, config ID, fresh container creation and anonymous-volume exclusivity use the fixed source's existing storage-only validator. Ambiguous/reused/named/bind storage fails closed. A new explicitly named and commented synthetic database is constructed only after those checks. No endpoint discovery or production secrets.

Artifact retrieval verifies fixed remote metadata, published ZIP hash, CRC, tar checksum, embedded source/schema, exact manifest inventory, every file/link and allowed paths. The fallback must retain identical safety source/runtime bytes and migration inventory. No .env, credentials, uploads, backups or customer data are loaded. This exclusion/hash check is not an exhaustive semantic secret certification.

PM2 uses the reviewed ecosystem configuration with only isolated cwd/log paths. A fresh dedicated UID, clean env, private PM2_HOME and UID-specific IPv4/IPv6 loopback-only network rules contain API/Web. External SMTP/WhatsApp/FCM/payment/AI credentials are absent; the synthetic AI key is unusable. MM_SAFE_STARTUP=1 remains set. Production names are safe inside a separate UID and daemon, not the VPS daemon.

## Rehearsal assertions

1. Frozen build of fallback source, no application startup and no database connection during build.
2. Populate disposable PG using the existing fixed legacy-schema constructor, both real commercial SQL migrations and application integration fixtures. Existing tests must pass; no assertion is removed.
3. Add a synthetic ImportBatch and synthetic migration-ledger rows/checksums. Ledger rows are representative fixture metadata, not evidence that every partial historical migration was executed.
4. Start fallback -> stop all owned old processes -> switch to Run 16 -> stop -> switch back.
5. At each stage: /ready database readiness, /health, Web /login, protected quotation 401, exactly two online fork/one-instance PM2 apps, no restarts, script paths tied to the intended artifact.
6. All public table row fingerprints (including invoices/payments/quotation history/ImportBatch/audit/ledger) and public constraint/trigger/function catalog fingerprint remain unchanged.
7. Compare before/after/rollback evidence; preserve both tarballs and their checksums/source identities.

Bounded build/process/SQL/HTTP waits and a 55-minute job cap. Cleanup kills only the fresh UID/private PM2 daemon, leaves network denial until owned processes are gone, drops only the exact marked database and removes only its own iptables chains. Hosted runner service teardown/disposal owns container/anonymous-volume removal; no Docker pruning or shared filesystem deletion. If a hard cancellation prevents traps, runner destruction is the final isolation boundary.

Uploads are allowlisted archives, checksums and generated summary JSON only. No raw logs, PM2 dumps, environment, database rows or npm configuration. The first run is still UNVERIFIED; failure must never produce a PASS summary.

## Not established by this gate

- Real non-production SMTP/mailbox/browser OTP flow remains pending an approved SMTP configuration and synthetic recipient. No customer mail is authorized.
- Both exact same-visible-unsealed-snapshot lock orderings remain UNVERIFIED under the committed-unsealed prohibition. No invariant is changed.
- This is artifact/schema/process/data rollback, not PostgreSQL recovery/PITR, production health, full browser E2E or authorization to deploy.
- PM2's root tarball is pinned; its transitive tool dependencies are resolved during the isolated job. It is not a claim of a fully reproducible PM2 dependency closure.
- Published Run 16 artifact expiry or missing metadata fails closed; no alternate artifact or checksum is guessed.

## Approval gates and tests

Offline tests: python -B scripts/phase-c-rollback/offline.test.py. Bash syntax: bash -n scripts/phase-c-rollback/run.sh. YAML/embedded JS/Python parsing is static evidence only.

Required next approval: review and merge this exact CI-only PR, then separately authorize its first manually dispatched GitHub-hosted disposable rollback run. Do not dispatch from the review branch; provenance requires main. No production migration/deployment is included.

Authoritative action pins:
- https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1
- https://github.com/actions/github-script/commit/3a2844b7e9c422d3c10d287c895573f7108da1b3
- https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020
- https://github.com/actions/upload-artifact/commit/cf430e030ddbb5b0abf93d22962f4752f3646cd9
- https://registry.npmjs.org/pm2/6.0.8
