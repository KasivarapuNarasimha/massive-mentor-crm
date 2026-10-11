# PostgreSQL 16.15 compatibility evidence

Executed 2026-10-11 on GitHub-hosted Ubuntu with fresh disposable service and run-specific synthetic databases. No production connection.

- Workflow run: https://github.com/KasivarapuNarasimha/massive-mentor-crm/actions/runs/38115308570
- Dispatcher checkpoint: f700048c296f0127ed1ba0abe09bd086a9b0ffc2
- Fixed tested source: 653f48a97c7b247147cbc6ede654c242e09e6ccd
- Official amd64 manifest: sha256:ec9f656f17c8b4dfebf49e58cf5c46d493d4846d4ea6d8b85d0637f68ee33bfc
- Official configuration: sha256:e8538db784b854a9baac5c1be6d059dcf0db257af2d94c8c5807b5fc15f11222

Both metadata bodies independently SHA-256 verified against registry-1.docker.io before dispatch; config is linux/amd64, PG_VERSION=16.15-1.pgdg12+2. Harnesses require server_version_num=160015. Provenance, image/config identity, fresh exclusive anonymous volume and source hashes passed.

## Commands and observed results

- bash docs/phase-c-review/validation/run.sh docs/phase-c-review/migration.sql.proposed: exit 0. Clean proposal migration, catalog subset, tenant FK/pointers, lifecycle/sealing/initial-send negatives, incomplete-commit rejection, numeric bounds, DDL rollback, second application rejection, send/edit and snapshot-insert/send protocols, pointer/sequence/revision races, idempotency uniqueness and synthetic audit rollback passed.
- bash apps/api/scripts/commercial-application-run.sh: exit 0. Applies both actual commercial migrations to disposable legacy schema, generates disposable CI client, executes commercial-workflow-postgres.test.cjs. 31 tests, 31 passed, 0 failed, 0 skipped. Actual HTTP tenant isolation, grants, billing, policy freshness, OTP, unpaid conversion, payment/reversal balances, Finance protection, critical audit rollback and service send/edit races passed.
- Local Python AST (harness and embedded workflow Python), node --check, bash -n (both runners), git diff --check: passed.
- No constraint or runtime code was changed for compatibility; five test/workflow files changed.

No PostgreSQL 16 incompatibility was observed within executed coverage. The proposal catalog suite calls itself a subset; this is not exhaustive deployed-schema equivalence or full browser/email validation.

## Explicitly unverified

Both independent-transaction same-visible-unsealed-snapshot sealing/item-trigger lock orderings remain unverified. A committed unsealed snapshot is prohibited; another transaction cannot see the creator's uncommitted snapshot. Visibility rejection tests passed but do not prove those exact lock orderings. SQL-only tests do not prove application authorization/hash/replay/audit integration; the separate 31 application tests provide bounded coverage, not exhaustive guarantees. Real SMTP delivery and full browser flow remain pending.

## Deployed dirty-baseline merge investigation (offline only)

Captured deployed base is a3938edb5553e6906d113ad5b4757cc4360bb439 plus dirty safety/import/runtime changes. Original checkout schema exactly matches recorded deployed SHA-256 d741d717f776340f55610ff7ed56581493089aad8370f0ae3e36644203e40a84 and includes ImportBatch/contact.importBatchId. Candidate schema omits both. Original Finance service also exactly matches captured deployed hash; index and permissions do not. Thus original checkout cannot represent the entire deployed dirty baseline.

Build an isolated release copy from verified deployed source, retain deployed historical migrations (including ImportBatch and repaired Activity migration), append only commercial models and Invoice composite relation/uniqueness, and merge only commercial hunks into overlapping files. Preserve startup containment, restore guard, strict lead/member/module checks, read-only billing and pinned detached-follow-up fix. Candidate currently lacks several of those deployed safety files and must never replace the dirty production tree wholesale. Revalidate combined schema/client, safety regressions and commercial integration on synthetic PostgreSQL 16.15 before release.

No release copy was falsely reconstructed from mismatching files. Exact non-secret deployed dirty source still needs a separately authorized capture or hash-matching local copies; this task prohibited production connection. Production migration/deployment authorization remains separate. Original checkout and unrelated proposed workflow file untouched; main unchanged.
