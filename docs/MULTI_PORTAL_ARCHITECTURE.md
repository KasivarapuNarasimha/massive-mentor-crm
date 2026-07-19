# Multi-Portal Production Architecture

Massive Mentor is split into **three completely separate portals**. This is not role switching inside one UI.

| Portal | Host (example) | Auth | Data |
|--------|----------------|------|------|
| **Demo** | `demo.massivementor.in` | Demo login only (`/api/demo/auth/*`) | Demo tenant only (`isDemo=true`) |
| **Super Admin** | `admin.massivementor.in` | Platform staff only (`/api/platform/auth/*`, `platformRole=super_admin`) | Customer **metadata** (plans, billing, tickets) — not day-to-day CRM |
| **Customer CRM** | `app.massivementor.in` | Business users (`/api/auth/*`) | Isolated per `businessId` |

## Navigation

```
Demo Portal        → Product demonstration (sample CRM)
Super Admin Portal → Platform management
Customer Portal    → Real CRM workspace
```

## Authentication isolation

- JWT includes `portal`: `customer` | `admin` | `demo`
- Super Admin tokens **cannot** call CRM routes
- Customer tokens **cannot** call `/api/platform/*`
- Demo tokens only work for the demo tenant path
- Support mode: Super Admin can request a short-lived customer token; action is **always audited** (`platform_support_impersonate`)

## Database strategy

**Logical isolation (current production baseline):**

- Single PostgreSQL with hard row filters:
  - Customer businesses: `portalKind=customer`, `isDemo=false`
  - Demo: `portalKind=demo`, `isDemo=true` (never listed in Super Admin customer lists)
- Super Admin manages metadata via platform tables: `PlatformInvoice`, `SubscriptionEvent`, `SupportTicket`, plus `Business` SaaS fields

**Physical separation (optional hardening):**

- `DATABASE_URL` — customers
- `DATABASE_URL_DEMO` — demo only  
  Can be wired later without changing portal URLs.

## Frontend routes

| Path | Portal |
|------|--------|
| `/login`, `/register`, `/dashboard/*` | Customer |
| `/admin/*` | Super Admin |
| `/demo/*` | Demo |

Host-based redirects are enforced in `apps/web/middleware.ts`.

## Local development

Without custom hosts:

- Customer: `http://localhost:3000/login`
- Super Admin: `http://localhost:3000/admin/login`
- Demo: `http://localhost:3000/demo/login`

Bootstrap accounts (seeded on API start):

| Account | Password | Portal | Env vars |
|---------|----------|--------|----------|
| `team@massivementor.in` | `Mentor@42` | Super Admin | `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` |
| `demo@massivementor.in` | `123456789` | Demo | `DEMO_EMAIL` / `DEMO_PASSWORD` |

## API surfaces

```
/api/auth/*          Customer register/login
/api/platform/*      Super Admin only
/api/demo/*          Demo auth + reset
/api/crm/* …         CRM (customer + demo JWTs; not admin platform JWT)
```

## Security rules

1. Demo users never see production customer data.
2. Customers never access Super Admin.
3. Super Admin support login-as-customer is audited.
4. Suspended/deleted businesses cannot log into Customer portal.
5. Cross-business CRM access remains blocked by tenant scope (`businessId`).

## Demo data reset

- `POST /api/demo/reset` (demo JWT)
- Wipes demo CRM rows and re-seeds sample leads/deals/tasks/meetings
- Never touches `isDemo=false` businesses
