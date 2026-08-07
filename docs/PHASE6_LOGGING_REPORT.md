# Phase 6 — Logging & Monitoring Report

**Focus:** Observability only — no features, UI, schema, or business-logic changes.

## Logging architecture

```
Request
  → requestContext middleware
      - X-Request-Id (inbound or UUID)
      - start timestamp
  → routes / auth (user, role, tenant)
  → res.finish
      → structured http.request log
      → metrics.recordHttpMetric

Errors
  → logError (stack + requestId + userId + businessId)
  → unhandledRejection / uncaughtException

Background jobs
  → runMonitoredJob(name, fn)
      - job.start / job.end JSON logs
      - in-memory history for /health.jobs

Audit
  → recordAudit → AuditLog table + audit.write log line
```

### Structured fields (HTTP)

| Field | Source |
|-------|--------|
| timestamp (`ts`) | logger |
| requestId | middleware |
| userId / role | auth (when present) |
| businessId | tenant context (when present) |
| endpoint / method | request |
| statusCode / responseTimeMs | finish handler |
| ip / userAgent | request |
| slow | responseTimeMs ≥ 1000 |

### Redaction

- Keys matching password/secret/token/authorization/api_key/jwt → `[REDACTED]`
- Bearer / JWT-shaped strings → `[REDACTED_TOKEN]`
- Phone-like digit runs → masked (last 4 only)
- **No request/response bodies** in access logs

## Files changed

| File | Role |
|------|------|
| `apps/api/src/lib/logger.ts` | Structured logger + sanitizer |
| `apps/api/src/lib/metrics.ts` | HTTP/DB/process metrics snapshot |
| `apps/api/src/lib/job-monitor.ts` | Job timing / success / failure ring buffer |
| `apps/api/src/lib/health-checks.ts` | Aggregated health/ready builders |
| `apps/api/src/middleware/requestContext.ts` | Request ID + access logging |
| `apps/api/src/middleware/auth.ts` | `requestId` / `requestStartedAt` on request type |
| `apps/api/src/index.ts` | Wire middleware, health, jobs, fatal handlers |
| `apps/api/src/services/audit.service.ts` | Expanded action types + structured audit.write |
| `deploy/ecosystem.config.cjs` | Logrotate notes |
| `deploy/pm2-logrotate.md` | Production log rotation runbook |
| `docs/PHASE6_LOGGING_REPORT.md` | This report |

## Health monitoring

### `GET /health` (additive fields; legacy `database` / `smtp` preserved)

- `checks.database` (+ latencyMs)
- `checks.storage` (writable probe)
- `checks.ai` / `checks.smtp` / `checks.redis` / `checks.whatsapp`
- `jobs` (running + last status per job)
- `metrics` (HTTP top routes, DB samples, memory)

### `GET /ready`

- `ready`, `database`, `databaseLatencyMs`, `storage`, `timestamp`

## Background job monitoring

Wrapped:

- `saas-billing-daily`
- `whatsapp-enterprise-jobs` (SLA + snooze processing)

Also recorded:

- lock skip → `job.skipped`
- backup scheduler remains via existing backup service (boot log lists it)

Each run records: start, end, durationMs, success/failure, retryCount, error message (truncated).

## Performance metrics

In-process (no external APM required):

- Per-route count / avg / max / slow count
- DB latency samples (from health checks)
- Process RSS / heap / uptime / loadavg (non-Windows)

Exposed under `/health.metrics`.

## Audit logs

`recordAudit` continues to write `AuditLog` (existing). Action type union documented for:

login, logout, lead/deal, role/permission, media, WhatsApp broadcast, assignment.

Also emits `audit.write` structured log line (ids only).

## Log rotation

See `deploy/pm2-logrotate.md`:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

## Production safety

- Secrets never logged
- Message bodies not in access logs
- Phone numbers masked in log field values
- Error responses may include `requestId` only (not stack in production)

## Verification

- `tsc --noEmit` (API) after changes
- Existing `/health` consumers: still receive `status`, `database`, `smtp`
