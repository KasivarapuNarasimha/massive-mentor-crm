#!/usr/bin/env bash
# Zero-downtime style deploy for Massive Mentor (build → migrate → PM2 reload)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Install"
pnpm install --frozen-lockfile

echo "==> Build API + Web"
pnpm build

echo "==> Prisma generate + migrate deploy"
cd apps/api
pnpm exec prisma generate
pnpm exec prisma migrate deploy || pnpm exec prisma db push
cd "$ROOT"

echo "==> PM2 reload (zero-downtime when possible)"
mkdir -p logs apps/api/storage/backups
if pm2 describe massive-mentor-api >/dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.cjs --env production
else
  pm2 start deploy/ecosystem.config.cjs --env production
fi
pm2 save

echo "==> Health check"
sleep 2
curl -fsS http://127.0.0.1:4000/health | head -c 400 || true
echo
curl -fsS http://127.0.0.1:4000/ready || true
echo
echo "Deploy complete."
