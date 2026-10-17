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
6. Durable public table row fingerprints (including invoices/payments/quotation history/ImportBatch/audit/ledger), operational-store structure and public constraint/trigger/function catalog remain unchanged. The single rate_limit_buckets table follows the strict per-request counter contract below; it is not ignored.
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

Executed offline tests: 9/9 PASS, including specific archive rejection classes and service-context placement. Command: python -B scripts/phase-c-rollback/offline.test.py. Bash syntax: bash -n scripts/phase-c-rollback/run.sh. YAML/embedded JS/Python parsing is static evidence only.

Required next approval: review and merge this exact CI-only PR, then separately authorize its first manually dispatched GitHub-hosted disposable rollback run. Do not dispatch from the review branch; provenance requires main. No production migration/deployment is included.

Authoritative action pins:
- https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1
- https://github.com/actions/github-script/commit/3a2844b7e9c422d3c10d287c895573f7108da1b3
- https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020
- https://github.com/actions/upload-artifact/commit/cf430e030ddbb5b0abf93d22962f4752f3646cd9
- https://registry.npmjs.org/pm2/6.0.8

GitHub job service context is bound at step level (not job env), validated and exported for later steps. This matches https://docs.github.com/en/actions/reference/workflows-and-actions/contexts. Static parsing is not GitHub server validation or database execution.


## Reviewed run 38706010859: private working-directory correction

The downloaded evidence ZIP matches GitHub artifact 11958792074's published SHA-256
`36a6a00c6eebf1c9c15ed9dda8edb23a1cb4c274bfb5b32a83d908c3654cb511`.
ZIP CRC and candidate/fallback tar checksums also passed offline inspection.
The diagnostic records UID 999/GID 987, accessible runtime/Node/PM2/app paths,
and EACCES for the inherited checkout and ancestors. CWD_PARENT_4 is owned by
UID/GID 1001 with mode 0750. Returning process.cwd() successfully is not proof
that the UID can traverse that pathname. No retained raw PM2 syscall/path error
identifies its exact internal operation, and the historical runner is gone.

The workflow runs the helper with working-directory: source. The pinned checkout
action creates the checkout with mkdirP; it does not establish a traversal grant
for the later isolated UID. The exact provisioning command that set the denied
ancestor's mode was not retained. Do not attribute it to the shell's umask alone.

The correction sets explicit cwd=root for every PM2 subprocess and its same-UID
permission probe, and uses a scoped cd to that private root for shell cleanup.
Caller checkout-path probes remain in the diagnostics. No access permissions,
UID, firewall rules, environment isolation, timeout, health/data assertions or
cleanup-primary-failure handling are relaxed. Existing runtime ownership setup
is unchanged; no recursive chmod/chown is added by this correction.

Offline tests exercise the actual nested PM2 boundary with mocked subprocesses,
all operation cwd settings, failure propagation, probe cwd, cleanup scope and a
frozen AST digest of every original require assertion. They do not prove Linux
PM2 runtime success. Merge/publication and another manually dispatched disposable
run require their applicable authorizations; this patch does not dispatch one.
Both exact same-snapshot sealing scenarios and commercial email/browser E2E
remain UNVERIFIED. The subsequently user-confirmed production password-reset
email is not evidence for isolated commercial quotation/OTP browser validation.


## Review correction after run 39010037180: operational rate-limit storage

The authenticated evidence ZIP matches published SHA-256
`04634ea0325e8b6dcdfbcef306dc4583e3485005ff28c393946f2eb20e796527`
and passes full ZIP CRC checks. The fixed fallback bundle also matches recorded
SHA-256 `02b717e2365ce50395698abb6fa74f1c833ceb85231a716e43847ba98f219fdc`.
Its actual compiled API mounts the PostgreSQL-backed general rate limiter before
commercial authentication. MM_SAFE_STARTUP requires an existing
rate_limit_buckets table and does not provision it. The fixed Prisma-derived
fixture omits this runtime-owned table. A mocked execution of the actual store
reproduced rejection before auth when that table is absent. Historical runtime
SQLSTATE was not retained, so this establishes a fixture defect and a supported
explanation of HTTP 500, not proof that no additional runtime defect exists.

The disposable setup now provisions the application's exact operational table
and reset-time index before taking the baseline and starting PM2. This does not
change the real schema, application, startup flag, limiter, privileges or firewall.

The previous all-public-table-data-unchanged description was incompatible with
real HTTP probes: shared rate limiting necessarily writes operational counters.
The integrity contract is now explicit, not a blanket exclusion:

- Every public table except the single named rate_limit_buckets table retains
  its original full-content hash, including CRM, Finance, users, ImportBatch,
  commercial/audit history and the migration ledger. Existing catalog checks
  and all original require assertions remain unchanged.
- The operational table must initially be empty. At most one exact loopback API
  bucket is allowed; no unexpected keys, extra fields or additional rows pass.
- Each fixed unauthenticated quotation request opens one checked transition.
  While active, the counter must increase by exactly one and retain its expiry.
  After expiry, it must reset to exactly one with a 15-minute expiry bounded by
  that request's measured start/end times. A request crossing expiry may take
  either exact transition. No other transition is accepted; at most three hits
  can occur because there are three fixed probes.
- With no outstanding probe, the operational rows must remain byte-for-value
  unchanged, including the final post-PM2-stop check. Table columns/defaults and
  indexes are hashed separately and must remain unchanged through all stages.
- The same 401 assertion still applies; a 500 or any other status stops the run.
  Operational data is never erased or restored merely to pass a fingerprint.

Tests are offline/mocked only. This correction requires review before merge and
separate authorization for another disposable execution. It has not passed a new
PostgreSQL/PM2 run. Production remains out of scope. Both sealing scenarios and
commercial email/browser validation remain UNVERIFIED.

The fixed legacy limiter wrappers share one backend windowMs. The final exported
exportLimiter initializes that backend to 15 minutes, even though the general
limiter declares one minute. This correction does not change immutable bundles
or silently claim that declared per-limiter windows work. The operational check
uses the actual fixed backend's 15-minute window. Correcting that separate legacy
application defect requires a separately tested release artifact.
