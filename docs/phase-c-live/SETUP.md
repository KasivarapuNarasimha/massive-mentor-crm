# Phase C live customer test — preparation

This is preparation only. It does not send mail, create GitHub secrets, start a database, migrate production, or deploy.

The registered workflow `.github/workflows/phase-c-postgres-validation.yml` remains the synthetic PostgreSQL gate. Its email adapter stores messages in memory. A live run needs the separate proposal at `docs/phase-c-live/phase-c-live-customer.yml`. That file is outside `.github/workflows`, so GitHub cannot dispatch it.

Pinned source for the proposal: `b1d5935325edfdad27827b27f44de340bde98ca0` on `codex/phase-c-release-candidate`. The application commit inside that pin is `1e58b4addc5eff5fb5053fabfb509f8c9617c401`.

## What is already prepared in this worktree

- `apps/api/scripts/phase-c-live-preflight.cjs` checks that the required settings exist and have a safe shape. Its output contains setting names and `ok` or `blocked`. It does not print values.
- `apps/api/scripts/phase-c-live-preflight.test.cjs` covers that behavior with synthetic fixtures.
- `docs/phase-c-live/phase-c-live-customer.yml` is the workflow proposal. Its only stage is `preflight`. It has no PostgreSQL service and no mail step.

Run the local check from `apps/api`:

```text
node scripts/phase-c-live-preflight.cjs
node --test --test-concurrency=1 scripts/phase-c-live-preflight.test.cjs
```

The first command exits 2 until the settings below exist in the process environment. That is the expected current result.

## Settings you store

Create GitHub Environment `phase-c-live` on `KasivarapuNarasimha/massive-mentor-crm` when you approve that account change. Add these environment secrets there, or keep them in an untracked environment file outside the repository. `.gitignore` already ignores `.env` files. Do not paste the values into chat, source files, or logs.

| Name | Shape |
|---|---|
| `SMTP_HOST` | Hostname of the test mailbox server |
| `SMTP_PORT` | `465` or `587` |
| `SMTP_USER` | Account that sends the test mail |
| `SMTP_PASS` | Password for that account |
| `SMTP_FROM` | From address on that mailbox domain |
| `COMMERCIAL_PUBLIC_URL` | `https` origin you control, with no username, password, query, or fragment |
| `COMMERCIAL_DELIVERY_KEY` | Output of `openssl rand -base64 32`, which must be 43 alphabet characters and end with `=` |
| `MM_PHASEC_TEST_MAILBOX` | Customer address that receives the quotation and the OTP |

Generate the delivery key on your machine and store only the secret. The product builds the customer link as `{COMMERCIAL_PUBLIC_URL}/quotation/review#<token>`.

Mailbox reading defaults to `manual`: you open the test mailbox yourself. Set environment variable `MM_PHASEC_MAILBOX_MODE` to `imap` only if you also store `IMAP_HOST`, `IMAP_PORT` (`993`), `IMAP_USER`, and `IMAP_PASS`. Leave the mode unset for the manual path.

## What still requires your account

1. Create the test mailbox and confirm you can open both the quotation message and the OTP message.
2. Choose the HTTPS origin you control. This session cannot register a domain or certificate.
3. Create the `phase-c-live` environment and store the named secrets. This session will not call the secrets API unless you approve that account change.
4. Approve a commit and push of these preparation files if you want them on the remote branch.
5. Approve moving the proposal into `.github/workflows` and dispatching `stage=preflight`. That uses GitHub-hosted minutes and reads the environment secrets. It still does not send mail.
6. Approve a later live-send design. The current API can send through SMTP, but the quotation is not delivered until the API and an empty PostgreSQL 16.15 database are running. The database must report `server_version_num` `160015`. Use a new database named for that run. Do not use the local PostgreSQL 17 service or a production database.
7. For the browser portion, open the message link, request the OTP, download the PDF, and accept. This session has no browser tool. An API-only continuation can parse the link and the code `is 123456.` from the mailbox after you approve mailbox access, and it still leaves the browser screens unverified.

## Expected live results, after a later approval

- Quotation message contains `/quotation/review#` and a 43-character token. Logs do not contain that token.
- OTP message says the code to accept the quotation and contains one 6-digit code. A wrong code is rejected.
- Customer PDF is named `QT-YYYY-00001.pdf`. Its visible text contains the quotation number and server total, and does not contain the token, email address, or phone number.
- Acceptance creates one invoice with stored status `sent`, display label Unpaid, `paidAt` empty, payment count 0, and one conversion row. Accepting again returns that same invoice.
- One commercial payment reduces the outstanding balance by the paid amount. A full payment is stored as `paid`. The payment audit commits with the ledger. A direct invoice update is rejected.

## Not claimed

Offline result: 341 passed, 0 failed. No SMTP server was used.

Synthetic PostgreSQL result: GitHub run `39026682028`, 31 passed, 0 failed, harness exit 0, disposable PostgreSQL `160015`. Those messages were captured in memory, not sent.

The two same-snapshot lock orders remain unverified by execution. The deferred completeness trigger still makes a committed unsealed snapshot unreachable. This preparation does not disable triggers.

Release status remains **NOT READY**.
