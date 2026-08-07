# Incident: API unreachable /health timeout

**Date:** 2026-08-07  
**Symptom:** CRM banner: `API unreachable — Request timed out (https://api.massivementor.in/health)`

## Evidence gathered (not guesses)

| Check | Result |
|-------|--------|
| DNS `api.massivementor.in` | A `200.141.0.25`, AAAA NAT64 |
| TCP 443 | Succeeds |
| Nginx | `Server: nginx/1.24.0 (Ubuntu)` on responses |
| `GET /ready` during incident window | **HTTP 200** `{"ready":true}` (PowerShell) |
| `GET /health` same window | **Timed out** (PowerShell 15s) |
| Later `GET /health` (curl -4) | **HTTP 200** ~0.2–0.5s, `database=up`, `env=production` |
| Process uptime when recovered | ~408–430s → **recently restarted** |
| Phase 6 enhanced `/health` body | **Not on production** (legacy shape only) |
| PM2 from this workstation | Not on PATH (ops must check on VPS) |

## Root cause (confirmed pattern)

1. **Banner only probes `/health` with a 4s abort.**  
2. **During the incident, `/health` stalled/timed out while `/ready` still answered 200.**  
   → API process / nginx was not fully dead; the **health path (or that connection) was unhealthy/slow**.  
3. **Process had just restarted** (low uptime) — cold start + concurrent boot work (templates, billing/WA jobs, DB) can delay requests.  
4. **Intermittent connection timeouts** reproduced later (one Origin-header curl hit 8s timeout; subsequent probes ~250ms).

Contributing design issues (fixed in code):

- Client connectivity treated **timeout on `/health` only** as total API failure.  
- Future Phase 6 health used **unbounded Prisma query** (could hang forever if DB blocked).  
- Future Phase 6 readiness treated **storage write failure** as not-ready (false offline if `BACKUP_DIR` wrong).  
- **4s** client timeout too aggressive for restarts.

## Fixes applied

| Change | Why |
|--------|-----|
| Banner / `checkHealth` prefers **`/ready`**, then `/health` | Ready stayed up when health timed out |
| Client probe timeout **10s** | Survive brief stalls/restarts |
| Any HTTP response = process reachable | Avoid “unreachable” on 503 degraded |
| Health DB check **2s hard timeout** | Never hang liveness |
| Liveness **`/health` always HTTP 200** if process responds | PM2/nginx + banner won’t treat degraded deps as dead process |
| Ready = **DB only** (storage soft) | Wrong BACKUP_DIR must not take site offline |
| Rate-limit table init **5s timeout** | Stuck DB can’t hang first API request forever |

## Ops actions on VPS (still required)

```bash
pm2 status
pm2 logs massive-mentor-api --lines 200
pm2 describe massive-mentor-api
curl -sS -m 5 http://127.0.0.1:4000/ready
curl -sS -m 5 http://127.0.0.1:4000/health
sudo tail -n 100 /var/log/nginx/error.log
sudo -u postgres psql -c 'SELECT 1'
```

Deploy this fix, then:

```bash
./deploy/deploy.sh
# or: pm2 reload massive-mentor-api --update-env
```

## Not the root cause

- Frontend “Retry” loop is a **symptom** of probe failure, not a UI bug.  
- Phase 6 logging middleware is **not on production yet** (health body lacks `checks`/`jobs`).  
- CORS: successful probes include normal CORS headers when Origin is set (when connection succeeds).
