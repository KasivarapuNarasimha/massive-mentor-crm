# Massive Mentor CRM — Release Candidate 1

| Field | Value |
|-------|--------|
| **Version** | **v1.0.0-RC1** (`1.0.0-rc.1`) |
| **Codename** | Final Release Candidate |
| **Date** | 2026-07-19 |
| **Status** | **Release Candidate — ready for staging / controlled production pilot** |

---

## Declaration

**Massive Mentor CRM v1.0.0 – Release Candidate (RC1)**

Core product scope is feature-complete for sales-led SaaS CRM:

- Multi-tenant CRM (leads, clients, deals, tasks, meetings, notes, documents)
- Dashboard, reports, finance, field sales, integrations
- AI modules (mentor, proposal, SWOT, forecast, next action, marketing, follow-up)
- Sales-led billing: trial, plans, Razorpay, invoices, Super Admin
- Auth, roles, portal isolation, backups, audit

RC1 freezes **new feature work**. Further commits should be **bug fixes, security, performance, and ops only**.

---

## Regression evidence (automated)

| Suite | Command | Result |
|-------|---------|--------|
| RC1 full workflow | `node scripts/rc1-regression.mjs` | **33 / 33 PASS** |
| Production readiness (High Priority) | `node scripts/prod-readiness-e2e.mjs` | **33 / 33 PASS** |
| Pre-launch multi-module | `node scripts/prelaunch-e2e.mjs` | **58 / 58 PASS** |

Artifacts:

- `docs/RC1_REGRESSION_RESULTS.json`
- `docs/PROD_READINESS_E2E_RESULTS.json`
- `docs/PRELAUNCH_E2E_RESULTS.json` (if re-run)

### RC1 workflow coverage

```
Health / Ready
→ Public register blocked
→ Super Admin login + CRM isolation
→ Customer provision (3-day trial)
→ Customer login
→ Billing access + plans
→ Dashboard reports (numeric money)
→ Lead + Client + Deal + Task + Meeting
→ Finance invoice (GST Decimal)
→ AI route (non-500)
→ Notifications + activity audit
→ Profile
→ Invalid JWT / bad password
→ Razorpay checkout order
```

---

## Release notes (RC1)

### Product

- Premium customer **Billing** UI (plans, trial, checkout confirm, success/failure)
- Premium **Dashboard** (hero KPIs, pipeline, charts, activity, AI insights)
- Plan-based feature gating (Starter / Professional / Enterprise + trial)
- Atomic invoice numbers, Decimal money, encrypted integration secrets
- AI quotas and distributed billing job locks

### Quality fixes in RC1 prep

| Area | Fix |
|------|-----|
| Reports KPIs | Decimal deal values no longer string-concatenated (`toMoneyNumber`) |
| Field sales export | JSON export downloads a file instead of `console.log` |
| Production logging | SMTP/env verbose dumps and AI token logs reduced in `NODE_ENV=production` |
| Import logging | Import debug logs gated to non-production |
| Env example | Production example includes Razorpay, trial, token encryption keys |
| Version | Root package set to `1.0.0-rc.1` |

### Not changed (by design)

- Business rules for trial length, billing activation, Razorpay webhooks
- Multi-tenant scoping model
- Portal role architecture

---

## Known issues (non-blocking for RC1 pilot)

| ID | Severity | Issue | Mitigation / plan |
|----|----------|--------|-------------------|
| K1 | Medium | JWT ~7d in localStorage | Shorten + refresh tokens post-RC |
| K2 | Medium | In-memory rate limits | Add Redis store for multi-instance |
| K3 | Medium | Multi-business users always use first membership | Active-business header / JWT claim |
| K4 | Medium | Finance dashboard may load many rows for large tenants | SQL aggregates |
| K5 | Low | Notes/documents still largely user-scoped | Add businessId model work |
| K6 | Low | Some role portals may 404 unused routes (e.g. legacy team paths) | Prefer portal-seeded menus |
| K7 | Ops | Live Razorpay keys must be rotated if ever exposed in dev `.env` | Secrets manager only |
| K8 | Ops | `TOKEN_ENCRYPTION_KEY` should be set explicitly in prod (fallback exists) | Set dedicated key before go-live |

Pilot is safe with: **single or few API instances**, webhook secret set, HTTPS, SMTP verified.

---

## Database migration notes

### Schema approach

Prisma models live in `apps/api/prisma/schema.prisma`.

**Preferred production:**

```bash
cd apps/api
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

**Bootstrap / lab only:**

```bash
pnpm exec prisma db push
```

### RC1-relevant models / columns

Ensure production DB has:

- SaaS: `SubscriptionPlan`, `Subscription`, `BillingPayment`, `InvoiceSequence`, coupons/webhooks as in schema
- Money: `Decimal` on finance, deals, billing amounts (not float)
- `AiUsageEvent` for AI quotas
- Business trial fields: `trialDays`, `trialStartDate`, `trialEndsAt`, `isTrial`, `isLocked`, `planStatus`
- Integration `config` JSON stores `enc:v1:…` ciphertext for secrets

### Data repair (safe)

- Active trials without admin extend events are normalized to **3 days** on access evaluation (repairs legacy 13–14 day windows).
- Idempotent plan seed: `ensureSubscriptionPlans()` on boot.

### Backups before migrate

Always take encrypted backup (`/admin/backups` or platform API) before `migrate deploy`.

---

## Environment variables checklist

### Required (API)

| Variable | Purpose |
|----------|---------|
| `NODE_ENV=production` | Hardens webhooks, logging, fail-closed paths |
| `DATABASE_URL` | Postgres with strong password |
| `JWT_SECRET` | ≥ 32 chars, unique per env |
| `PORT` | Default 4000 behind Nginx |
| `FRONTEND_URL` | CORS allowlist (app + admin + demo origins) |
| `CUSTOMER_APP_URL` | Password reset links |
| `ADMIN_APP_URL` | Admin reset links |

### Strongly recommended

| Variable | Purpose |
|----------|---------|
| `TRUST_PROXY=true` | Correct IPs / cookies behind Nginx |
| `SMTP_*` | Production email delivery |
| `BACKUP_ENCRYPTION_KEY` | Backup AES key |
| `TOKEN_ENCRYPTION_KEY` | Integration secrets at rest |
| `BACKUP_DIR` | Durable volume for backups + invoice PDFs |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Live checkout |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook verification (required in prod) |
| `GROQ_API_KEY` or `OPENAI_API_KEY` | AI features |
| `TRIAL_DAYS=3` | Free trial length |

### Web

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | e.g. `https://api.example.com/api` |
| `NODE_ENV=production` | Next production build |

### Must remain off

| Variable | Value |
|----------|--------|
| `ALLOW_PUBLIC_REGISTER` | unset or `false` |

See `apps/api/.env.production.example` and `apps/web/.env.production.example`.

---

## Deployment checklist

1. [ ] Secrets loaded from secrets manager (not git)
2. [ ] `RAZORPAY_WEBHOOK_SECRET` set; webhook URL registered in Razorpay dashboard
3. [ ] Rotate any previously exposed live payment keys
4. [ ] Postgres backup taken; restore drill once
5. [ ] `prisma migrate deploy` + `prisma generate`
6. [ ] `pnpm build` (api + web)
7. [ ] PM2 / process manager with `deploy/ecosystem.config.cjs`
8. [ ] Nginx TLS (`deploy/nginx.conf`) + HSTS
9. [ ] `/health` and `/ready` green
10. [ ] Super Admin can provision a test customer
11. [ ] Customer trial = 3 days; billing page loads plans
12. [ ] Test Razorpay in test mode or ₹1 live pilot
13. [ ] SMTP password reset email received
14. [ ] Manual backup create + verify
15. [ ] CORS rejects unknown origins
16. [ ] Public `/register` returns 403

Full ops guide: `DEPLOYMENT.md`.

---

## Rollback plan

### Application rollback

1. Keep previous PM2 release directory or Docker image tag.
2. `pm2 reload` previous build (or redeploy last known-good commit).
3. Confirm `/health` + `/ready`.

### Database rollback

1. Prefer **forward fixes** for schema (Prisma migrations rarely reverse easily).
2. If catastrophic: stop API writes → restore latest encrypted backup via Super Admin restore flow or ops restore from `BACKUP_DIR`.
3. Document restore phrase requirements (`RESTORE PLATFORM` for full restore).

### Billing rollback

1. Disable checkout via removing Razorpay keys or plan `status` (ops).
2. Do not replay webhooks without idempotency review (system is designed idempotent by payment id).

### Communication

1. Status page / email to pilot tenants if CRM locked erroneously.
2. Super Admin can extend trial / activate business from admin portal.

---

## How to re-run RC gates

```bash
# API must be on :4000
node scripts/rc1-regression.mjs --base http://127.0.0.1:4000
node scripts/prod-readiness-e2e.mjs --base http://127.0.0.1:4000
node scripts/prelaunch-e2e.mjs --base http://127.0.0.1:4000
```

Or: `pnpm test:rc`

---

## Post-RC roadmap (not in RC1 scope)

1. Redis rate limits + multi-instance hardening  
2. JWT refresh tokens  
3. Multi-business workspace switcher  
4. Finance SQL aggregates  
5. GA `v1.0.0` after 1–2 week pilot with no Sev-1 defects  

---

*RC1 prepared after full-module quality pass: cleanup, bug fixes, performance/logging hardening, and automated regression.*
