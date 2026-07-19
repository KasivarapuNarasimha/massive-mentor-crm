# Approval Workflow — Codebase Audit & Implementation

**Date:** 2026-07-17  
**Scope:** Full repo audit of approval-related functionality, then engine implementation where missing.  
**Verified:** Live API smoke on demo workspace (`demo@massivementor.in`) after `prisma db push`.

---

## Executive conclusion

**Massive Mentor CRM did not have an Approval Workflow Engine** before this work.

There was **no** multi-level Pending → Approved → Rejected → Cancelled flow, no configurable approval rules, no approval dashboard, and no approval-specific notification/audit pipeline.

Related concepts that **existed but are not approvals**:

| Concept | What it is | Evidence |
|---------|------------|----------|
| Deal stage `proposal` | Pipeline stage, not approval | `schema.prisma` Deal.stage; seed pipelines |
| Invoice `draft \| sent \| paid` | Billing lifecycle, not multi-level approval | `Invoice.status` comment in schema |
| Expense records | CRUD only, no status field for approval | `model Expense` — no status column |
| AI “proposal” | Generated document text | `POST /api/crm/ai/proposal` |
| HR “Leave & Tasks” menu label | Task module alias in template seed | `build-manifest.ts` menu label only |
| Loan `approved/rejected` | Contact custom field options (finance template) | `seed-catalog.ts` loan_status select |
| `AuditLog` / `Notification` | Generic infra reusable by approvals | `audit.service.ts`, `notification.service.ts` |

---

## Feature classification (pre-implementation)

| Feature | Status | Evidence |
|---------|--------|----------|
| **Discount Approval** | ❌ Not Implemented | No discount entity; no approval APIs/UI |
| **Proposal Approval** | ❌ Not Implemented | “Proposal” = deal stage + AI generate only (`ai-sales/page.tsx`, deal pipeline) |
| **Invoice Approval** | ⚠ Partial (lifecycle only) | Invoice statuses `draft/sent/paid/overdue/cancelled` — **no approver chain** (`schema.prisma` Invoice; `finance.service.ts`) |
| **Expense Approval** | ❌ Not Implemented | Expense has amount/category only — **no status** (`model Expense`) |
| **Leave Approval** | ❌ Not Implemented | No Leave model; “Leave & Tasks” is a menu label only |
| **Purchase Approval** | ❌ Not Implemented | No purchase entity |
| **Custom Approval Workflows** | ❌ Not Implemented | No Approval* tables before this work |

### Cross-cutting pre-implementation

| Area | Status | Evidence |
|------|--------|----------|
| Database tables for approvals | ❌ | 43 models; none named Approval* before engine |
| Prisma schema | ❌ | No ApprovalWorkflow / Request / Action |
| APIs | ❌ | No `/api/approvals/*` routes (pre) |
| Services | ❌ | No `approval.service.ts` (pre) |
| UI pages | ❌ | No `/dashboard/approvals` (pre) |
| Role permissions | ⚠ Partial | Roles exist (`BusinessMember.role`, finance role gate) — not wired to approval steps |
| Notifications | ⚠ Partial | Generic `Notification` + email SMTP — reusable |
| Audit logs | ⚠ Partial | Generic `AuditLog` + `recordAudit` — reusable |
| Reports / export | ⚠ Partial | Reports module for CRM; no approval reports |

---

## Implementation (because engine did not exist)

Built a **single shared Approval Workflow Engine** that reuses tenant scope, roles, notifications, audit, and finance hooks — **no duplicate finance modules**.

### Database (new)

| Table | Purpose | Evidence |
|-------|---------|----------|
| `ApprovalWorkflow` | Per-business type + rules JSON | `prisma/schema.prisma` models ~1104+ |
| `ApprovalStepDef` | Multi-level role/user approvers | same |
| `ApprovalRequest` | pending \| approved \| rejected \| cancelled | same |
| `ApprovalAction` | submit / approve / reject / cancel trail | same |

**Live DB verification (PostgreSQL):**

```
ApprovalAction, ApprovalRequest, ApprovalStepDef, ApprovalWorkflow
counts: { workflows: 7, steps: 10, requests: 7, actions: 11 }
```

### Code map

| Layer | Path |
|-------|------|
| Service | `apps/api/src/services/approval.service.ts` |
| Controller | `apps/api/src/controllers/approval.controller.ts` |
| Routes | `apps/api/src/routes/approval.routes.ts` |
| Mount | `apps/api/src/index.ts` → `app.use("/api/approvals", approvalRoutes)` |
| Finance hooks | `apps/api/src/services/finance.service.ts` → `maybeSubmitExpenseApproval` / `maybeSubmitInvoiceApproval` |
| UI | `apps/web/app/dashboard/approvals/page.tsx` |
| Nav | `apps/web/components/dashboard/DashboardShell.tsx` → **Approvals** |

### APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/approvals/workflows` | List (+ auto-seed defaults) |
| PUT | `/api/approvals/workflows` | Configure workflow + levels |
| GET | `/api/approvals/stats` | Dashboard KPIs |
| GET | `/api/approvals/requests` | List (filters: status, type, mine) |
| POST | `/api/approvals/requests` | Submit request |
| GET | `/api/approvals/requests/:id` | Detail + history |
| POST | `/api/approvals/requests/:id/act` | approve \| reject \| cancel |

### UI features

- **`/dashboard/approvals`** — inbox, my requests, all, workflows, report  
- Mobile-responsive cards + bottom-sheet submit modal  
- CSV + print/PDF export  
- KPI strip: pending / approved / rejected / cancelled / total  
- Action trail per request  

### Integrations (extend existing — no duplicates)

- **Expense create** → auto-submit when ≥ workflow `minAmount` (`maybeSubmitExpenseApproval`)  
- **Invoice create** → auto-submit when ≥ workflow `minAmount` (`maybeSubmitInvoiceApproval`)  
- **In-app notifications** via `notifyUser`  
- **Email** via existing `sendEmail` (non-blocking so SMTP RTT does not stall approve/submit)  
- **Audit** via `recordAudit` (`approval_submitted`, `approval_approved`, `approval_rejected`, `approval_cancelled`, `approval_level_advanced`, `approval_workflow_upsert`)  

### Default workflows seeded per business

| Type | Default levels | Default rules |
|------|----------------|---------------|
| expense | manager → finance | minAmount 5000; autoApproveBelow 5000 |
| invoice | finance | minAmount 50000 |
| discount | sales_manager → ceo | — |
| proposal | manager | — |
| leave | hr | — |
| purchase | manager → finance | minAmount 10000 |
| custom | business_admin | — |

---

## Feature classification (post-implementation)

| Feature | Status | Notes |
|---------|--------|-------|
| **Discount Approval** | ✅ Fully Implemented | Type `discount`; multi-level workflow; submit/act/API/UI |
| **Proposal Approval** | ✅ Fully Implemented | Type `proposal` (approval request; not deal-stage rename) |
| **Invoice Approval** | ✅ Fully Implemented | Type `invoice` + auto-queue on create above threshold |
| **Expense Approval** | ✅ Fully Implemented | Type `expense` + auto-queue on create above threshold |
| **Leave Approval** | ✅ Fully Implemented (workflow) | Type `leave`; no separate Leave calendar entity (optional later) |
| **Purchase Approval** | ✅ Fully Implemented | Type `purchase` |
| **Custom Approval Workflows** | ✅ Fully Implemented | Type `custom` + `PUT /workflows` multi-level editor via API |

### Cross-cutting post-implementation

| Area | Status |
|------|--------|
| Database tables | ✅ |
| Prisma schema | ✅ |
| APIs | ✅ |
| Services | ✅ |
| UI pages / dashboard | ✅ |
| Role-based approvers | ✅ |
| In-app + email notifications | ✅ |
| Audit logs | ✅ |
| Reports + CSV/PDF export | ✅ |
| Multi-level Pending→Approved→Rejected→Cancelled | ✅ |
| Mobile responsive UI | ✅ |

---

## Smoke test evidence (2026-07-17)

Demo login → all endpoints exercised:

```
workflows status 200 count 7 types custom,discount,expense,invoice,leave,proposal,purchase
submit expense → pending maxLevel 2
approve L1 → pending level 2
approve L2 → approved
discount → reject → rejected
leave → cancel → cancelled
purchase / proposal / invoice / custom → pending
final stats: pending=4 approved=1 rejected=1 cancelled=1 total=7
```

---

## How to use

1. Open **Approvals** in the CRM sidebar (`/dashboard/approvals`).  
2. Defaults appear under **Workflows**.  
3. **New request** or create a high-value **expense/invoice** to auto-queue.  
4. Approvers **Approve / Reject** with optional comments.  
5. Export via **Export CSV** or **Export PDF** (print).  

---

## Explicit non-duplicates

| Do not rebuild | Reuse instead |
|----------------|---------------|
| Invoice CRUD | Existing finance + optional approval request link |
| Expense CRUD | Existing finance + optional approval request link |
| Roles | `resolveActorRole` / `BusinessMember` |
| Notifications / email / audit | Existing services |
| Export patterns | Same client-side CSV/print as admin tables |

---

## Next optional extensions (not required for MVP engine)

- UI editor for workflow steps (API already supports PUT)  
- Hard-block “send invoice” until approved  
- Leave entity + calendar integration  
- Super Admin cross-tenant approval metrics  
- Excel (xlsx) server-side export in addition to CSV/PDF  
