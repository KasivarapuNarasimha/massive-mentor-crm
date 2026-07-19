# SaaS Subscription, Trial & Billing

Production sales-led multi-tenant model for Massive Mentor CRM.

## Sales flow

Marketing → Lead → Demo → Deal closed → **Super Admin Create Customer** → Welcome email + 3-day trial → Trial reminders → Expire → Subscribe (Razorpay) → Unlock.

## What was reused

| Existing | Role |
|----------|------|
| `Business.plan`, `planStatus`, `trialEndsAt` | Extended with trial/lock fields |
| `PlatformInvoice`, `SubscriptionEvent` | Ops history + events |
| `createCustomerBusiness` / platform routes | Extended provision path |
| Super Admin **Customers** (`/admin/businesses`) | Create customer UI |
| `sendEmail`, audit, auth | Credentials + invoices |
| Finance `Payment` model | **Unchanged** (tenant CRM AR) |

## New models

- `SubscriptionPlan` — catalog (Starter/Pro/Enterprise × monthly/annual)
- `Subscription` — trial + paid periods per business
- `BillingPayment` — Razorpay SaaS payments (not CRM client payments)

## APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/billing/access` | Trial/lock status |
| GET | `/api/billing/overview` | Billing settings page |
| GET | `/api/billing/plans` | Plan catalog |
| POST | `/api/billing/checkout/order` | Razorpay order |
| POST | `/api/billing/checkout/verify` | Signature verify + activate |
| POST | `/api/platform/businesses` | Provision customer (no password = auto) |
| POST | `/api/platform/businesses/:id/extend-trial` | Super Admin |
| POST | `/api/platform/businesses/:id/reset-trial` | Super Admin |
| POST | `/api/auth/register` | **403 disabled** |

## Env

```
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=   # required in production for activation
TRIAL_DAYS=3
SUPPORT_EMAIL=
SUPPORT_WHATSAPP=
CUSTOMER_APP_URL=
COMPANY_GSTIN=             # optional on invoices
BACKUP_DIR=                # invoices stored under BACKUP_DIR/invoices
```

Secret key is never sent to the browser (only `KEY_ID` for Checkout).

## Production payment activation (webhook-only)

1. `POST /api/billing/checkout/order` — always creates a **new** Razorpay order (retry never reuses).
2. Frontend Checkout → `POST /api/billing/checkout/verify` — verifies client signature, marks `authorized` only.
3. Razorpay → `POST /api/payments/razorpay/webhook` — verifies `RAZORPAY_WEBHOOK_SECRET`, idempotent via `RazorpayWebhookEvent`, then **activates** subscription, generates PDF invoice, emails, notifies Super Admin.

Dev without webhook secret: system activation is allowed only when `NODE_ENV !== production`.

## Webhook events

| Event | Action |
|-------|--------|
| `payment.captured` / `order.paid` | Activate subscription (idempotent) |
| `payment.failed` | Mark payment failed |
| `refund.processed` | Refund + lock CRM |

## Invoice PDF

- Generated on activation (`billing-invoice-pdf.service.ts`)
- Download: `GET /api/billing/invoices/:id/pdf`

## Super Admin Revenue

- `GET /api/platform/revenue` → UI `/admin/revenue` (MRR, ARR, charts, recent payments)

## Coupons

- Models: `BillingCoupon`, `CouponRedemption`
- Validate: `POST /api/billing/coupons/validate`
- Applied at order creation (percent / flat, expiry, max uses)

## Renewals

- Daily job: trial reminders, **renewal reminders 7/3/1 days**, grace period then lock
- `Business.gracePeriodDays` (default 3)

## Backups

- Existing `startBackupScheduler` (platform + tenant) remains the automated DB backup path.

## Route protection

- API middleware `requireBillingAccess` returns **402** + `SUBSCRIPTION_REQUIRED` for CRM routes when trial/sub expired.
- Dashboard layout redirects to `/subscription-required` (Billing page still allowed).

## Daily job

Every 6 hours (+ 60s after boot): lock expired trials/subs, send reminder emails.
