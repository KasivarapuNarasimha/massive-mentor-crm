# Massive Mentor — Production Deployment Guide

Enterprise deployment for real customer data. Follow this checklist end-to-end.

## Architecture

| Layer | Component |
|-------|-----------|
| TLS / reverse proxy | Nginx (`deploy/nginx.conf`) |
| Process manager | PM2 (`deploy/ecosystem.config.cjs`) |
| API | Node 22, Express, Prisma → PostgreSQL |
| Web | Next.js 15 (standalone or `next start`) |
| Backups | Encrypted files under `BACKUP_DIR` + schedules in API |

## Prerequisites

- Ubuntu 22.04+ (or similar) VPS
- Node.js **22+**, pnpm **9+**
- PostgreSQL **16+**
- Nginx + Certbot
- PM2 (`npm i -g pm2`)
- Firewall: only 80/443 public; Postgres localhost only

## 1. Production environment

1. Copy `apps/api/.env.production.example` → server secrets (e.g. `/etc/massivementor/api.env`).
2. Copy `apps/web/.env.production.example` → `apps/web/.env.production`.
3. Set strong unique values for:
   - `JWT_SECRET` (≥ 32 chars)
   - `BACKUP_ENCRYPTION_KEY`
   - `DATABASE_URL` (strong password, SSL if remote)
4. Set `FRONTEND_URL` to exact production origins (CORS allowlist).
5. Create Hostinger mailbox `noreply@…` and configure SMTP (do not use team@ as SMTP identity if it is also a recipient).

API validates env with Zod at boot — process **exits** if invalid.

## 2. PostgreSQL

```bash
sudo -u postgres createuser mm_prod -P
sudo -u postgres createdb massivementor -O mm_prod
```

Apply `deploy/postgresql.production.conf.snippet` guidance (shared_buffers, slow query log).

```bash
cd apps/api
pnpm exec prisma migrate deploy   # preferred
# or first-time:
pnpm exec prisma db push
pnpm exec prisma generate
```

## 3. SSL / HTTPS

```bash
sudo certbot --nginx -d app.massivementor.in -d admin.massivementor.in -d demo.massivementor.in -d api.massivementor.in
sudo cp deploy/nginx.conf /etc/nginx/sites-available/massivementor
sudo ln -sf /etc/nginx/sites-available/massivementor /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 4. Build & run (PM2)

```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh
pm2 status
curl -s https://api.massivementor.in/health
curl -s https://api.massivementor.in/ready
```

### Zero-downtime deploys

`deploy/deploy.sh` runs `pm2 reload` after build. API handles `SIGTERM` gracefully (drain, disconnect Prisma, stop backup scheduler).

### Crash recovery

PM2 `autorestart: true`, `max_restarts`, `max_memory_restart`. Systemd optional: `pm2 startup`.

## 5. Security checklist

- [ ] `NODE_ENV=production`
- [ ] Helmet + HSTS (API + Nginx)
- [ ] CORS allowlist only production origins
- [ ] Rate limits on login, register, password reset, general API
- [ ] JWT portal isolation (customer / admin / demo)
- [ ] `tokenVersion` session revocation on password change
- [ ] Trust proxy enabled behind Nginx
- [ ] Backups encrypted AES-256-GCM
- [ ] Secrets not in git
- [ ] Postgres not exposed publicly

## 6. Backups

| Feature | Location |
|---------|----------|
| Super Admin UI | `/admin/backups` |
| Platform API | `/api/platform/backups*` |
| Tenant API | `/api/backups` |
| Schedules | daily / weekly / monthly (auto-seeded) |
| Encryption | `BACKUP_ENCRYPTION_KEY` |
| Notify failures | `BACKUP_NOTIFY_EMAIL` |

Restore requires **verify + confirmation token** (and `RESTORE PLATFORM` phrase for full restore).

## 7. Monitoring

- `GET /health` — liveness + DB + SMTP flags  
- `GET /ready` — readiness for load balancers  
- Super Admin → **Monitoring**  
- PM2 logs: `pm2 logs`  
- Postgres: `log_min_duration_statement = 500`

## 8. Rollback

```bash
git checkout <previous-tag>
./deploy/deploy.sh
# If data issue: Super Admin → Backups → verify → restore confirm
```

## 9. Migration checks

Before deploy:

```bash
pnpm --filter @massivementor/api exec prisma migrate status
pnpm --filter @massivementor/api exec prisma validate
```

## Static asset optimization

Nginx caches `/_next/static/` with long `Cache-Control`. Next.js production build minifies automatically.
