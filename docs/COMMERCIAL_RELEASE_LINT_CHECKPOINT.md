# Verified lint cleanup checkpoint

Baseline: 39866920756cd6c75ef970fab431433fc96ff9c5. Release branch only. Production readiness remains NO-GO.

## Actual checks

- Full offline regression suite: 328 passed, zero failed/skipped. Run with node --test --test-reporter=tap on commercial-foundation, commercial-pricing, commercial-document, commercial-customer, restore-safety, lead-assignment-safety, strict-business-resolution, strict-module-authorization, release-lint-regression scripts under apps/api/scripts.
- API: node node_modules/typescript/bin/tsc --noEmit --incremental false from apps/api: PASS.
- Whitespace: git diff --check: PASS.
- API lint: node node_modules/eslint/bin/eslint.js src --format json from apps/api: FAIL, five no-explicit-any diagnostics. Recommended configuration unchanged.
- Password compatibility: all 65,536 UTF-16 code units tested at boundaries and internally; 262,144 equal-result comparisons.
- Compiled imports, disabled integration arity and four-argument Express error handler preserved. Registry cleanup emits byte-identical JavaScript against the fixed baseline.

## Preservation failure diagnosis

The previous test compared whole function text with HEAD, including unused catch bindings and equivalent regex escaping. It now permits only exact reviewed changes in getDashboardReports, backupDb and attachmentDisposition. All other function text remains exact; function inventory is additionally checked. Negative tests ensure the exception cannot permit changed writes, success responses, restore functions or other files. Backup function body and restore guards remain protected.

## Remaining legacy lint work

- apps/api/src/services/ai-command/registry.ts:51: @typescript-eslint/no-explicit-any
- apps/api/src/services/ai-command/registry.ts:74: @typescript-eslint/no-explicit-any
- apps/api/src/services/ai-command/registry.ts:503: @typescript-eslint/no-explicit-any
- apps/api/src/services/ai-command/registry.ts:544: @typescript-eslint/no-explicit-any
- apps/api/src/services/ai-command/registry.ts:1205: @typescript-eslint/no-explicit-any

These cover the heterogeneous ActionDef<any> registry, a contact-result callback and three wrapper/fallback casts. Removing runtime fallback expressions was rejected by automatic approval review; that edit never ran. A typed per-action argument/result boundary must preserve the existing legacy fallback and resolver contracts. No rule was disabled and no suppression added.

## Artifact and runtime limitations

GitHub run 38137011527 artifact 11701121837 remains visible, 222 MB. Published ZIP digest: 647a76d633eb1cdc8ad1f1b57208d960489ff016810a0cd512b892595298f563. Authenticated browser download retry timed out after 55 seconds; no archive was obtained and no independent checksum/source/content verification is claimed. The artifact predates this cleanup. No new Linux artifact was built.

Actual-artifact/populated-PostgreSQL/PM2 rollback rehearsal: UNVERIFIED. Docker, psql and gh were not found; wsl --list --quiet returned help with exit 1, not an isolated runnable Linux/database environment. No database was accessed. Reliable authenticated artifact retrieval and a confirmed disposable Linux runtime remain prerequisites. Previous filesystem-only rehearsal is not full rollback evidence.

Real SMTP/browser validation: PENDING explicitly approved non-production configuration and synthetic recipient.

Both same-snapshot sealing lock-order scenarios remain UNVERIFIED under the committed-unsealed prohibition. No invariant, migration or harness was weakened.

No production access, migrations, schema/config/workflow changes or deployment. Original checkout and main untouched.

## Local evidence hashes

- mm-release-verified-regressions.log: SHA256 fb9f02c72cfdd1d3d40af747cb3e85a1547f79c0e8241106296e6128dd78ed38
- mm-release-final-lint.json: SHA256 96e5d24aade5973052972122b3116a6b6f21beb674d7c1a706df5c39afb75dae

## Follow-up registry and artifact verification

Four additional registry diagnostics were corrected with type-only assertions and inference. All legacy fallback expressions remain intact. The unchanged byte-identical emitted-JavaScript test and restore/preservation suite pass: 14/14. Full API lint now reports one remaining no-explicit-any error at registry.ts:51 (heterogeneous ActionDef argument boundary). No suppression or recommended rule change. Final API TypeScript --noEmit --incremental false: PASS. Whitespace check: PASS.

Run #16 ZIP verification completed in a separate owned temporary inspection directory: ZIP CRC, fixed published SHA256 647a76d633eb1cdc8ad1f1b57208d960489ff016810a0cd512b892595298f563, source 1bc44ba9d9a0951645df42a853bc5799650865ef, inner tar SHA256 8d61dc51b6111a3ba34c5c46bed817020edfad692e3af8efd8430855da4fda26, every manifest hash/inventory/path/link, source safety/schema/package hashes. Original ZIP unchanged. Secret exclusion/pattern scan is not exhaustive secret certification.

Full actual-artifact/PM2/populated-history rollback remains UNVERIFIED. Existing manual workflow has integration/packaging gates only. No compatible fallback Linux artifact is verified. Authenticated browser access is available; new rollback workflow activation/execution still needs its reviewed source/artifact/PM2 pins and explicit authorization. No workflow was created/activated in this follow-up. SMTP remains unavailable pending approved non-production configuration and synthetic recipient. Production NO-GO; no production/database operations.

## Completed per-action boundary (2026-10-14)

Registry-wide ActionDef<any> replaced by per-action contracts mirroring unchanged Zod input schemas, plus explicit normalized resolver fields. Legacy z.any fields remain permissive as before; this is not additional runtime validation. Permission checker accepts only metadata it reads. Runtime registry and permission JS are byte-identical against fixed reviewed checkpoint. New offline compile-time negative tests reject wrong name types, absent normalized SKU, invalid contact enum, absent stage and malformed resolved labels. Full API recommended lint: PASS (zero errors). API TypeScript --noEmit --incremental false: PASS. Affected suite: 16/16 PASS. No existing test was weakened. Database/application concurrency suites were not repeated for these type-only changes. Full rollback, real SMTP/browser and the two exact sealing races remain UNVERIFIED. No production operation.
