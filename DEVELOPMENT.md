# Massive Mentor — Local Development Guide

This guide explains how to run the project after Milestone 0 scaffolding is complete.

---

## Prerequisites

- **Node.js 22+** (LTS recommended)
- **pnpm 9+** (strongly recommended over npm/yarn)
- **Docker Desktop** (for PostgreSQL)
- Git

---

## 1. Initial Setup (One Time)

```powershell
# Clone the repository (if not already done)
cd C:\Users\acer\massive-mentor

# Install all dependencies (workspaces)
pnpm install

# Start the database
pnpm db:up

# Wait ~10 seconds for Postgres to be ready, then:
pnpm db:push
```

### Environment Files

The following files already exist with safe defaults:

- `.env.example` (root)
- `apps/api/.env`
- `apps/api/.env.example`
- `apps/web/.env.local`

**Important:** Replace the placeholder `OPENAI_API_KEY` in `apps/api/.env` when you reach AI features (Milestone 4+).

---

## 2. Running the Project

### Recommended (both apps together)

```powershell
pnpm dev
```

This starts:
- **API** → http://localhost:4000 (with hot reload via tsx)
- **Web** → http://localhost:3000 (Next.js with hot reload)

You will see colored output from both services thanks to `concurrently`.

### Run individually

```powershell
pnpm dev:api     # Backend only
pnpm dev:web     # Frontend only
```

---

## 3. Database Commands

```powershell
pnpm db:up       # Start Postgres (Docker)
pnpm db:down     # Stop Postgres
pnpm db:push     # Push schema changes (fast, no migration history)
pnpm db:migrate  # Create a proper migration
pnpm db:reset    # ⚠️ DANGER: Drops all data and re-applies schema
pnpm db:seed     # (Future) Populate demo data
```

## 4. Prisma Client Generation (Important)

Prisma Client must be generated before the backend can start.

**Recommended commands (run from project root):**

```powershell
# Generate Prisma Client (recommended)
pnpm prisma:generate

# Or directly targeting the API package
pnpm --filter @massivementor/api prisma generate
```

After changing `prisma/schema.prisma`, always run one of the above commands.

The project is configured so that `pnpm install` and `pnpm dev:api` will automatically try to generate the client via `postinstall` and the updated dev script.

---

## 4. Useful URLs (after starting)

| Service           | URL                              | Purpose                     |
|-------------------|----------------------------------|-----------------------------|
| Frontend          | http://localhost:3000            | Next.js app                 |
| Backend API       | http://localhost:4000            | Express server              |
| API Health        | http://localhost:4000/health     | Quick status check          |
| API Info          | http://localhost:4000/api        | Available endpoints         |
| Postgres (Docker) | localhost:5432                   | Database                    |

---

## 5. Project Structure Highlights

```
apps/web/          → Next.js 15 frontend (shadcn/ui ready)
apps/api/          → Express + Prisma backend
apps/api/prisma/   → Database schema
```

---

## 6. Next Steps

After the environment is running:

1. Open http://localhost:3000 — you should see the placeholder landing page.
2. Open http://localhost:4000/health — you should see a JSON health response.
3. Proceed to **Milestone 1**: Authentication (Register/Login).

---

## Troubleshooting

**"pnpm: command not found"**
→ Install pnpm globally: `npm install -g pnpm`

**Database connection error**
→ Make sure Docker is running and `pnpm db:up` succeeded.
→ Check that port 5432 is not already in use.

**Port already in use**
→ Either kill the process or change `PORT` in `apps/api/.env`.

**Prisma client not generated**
→ Run: `cd apps/api && npx prisma generate`

---

**You are now ready to begin real feature development.**
