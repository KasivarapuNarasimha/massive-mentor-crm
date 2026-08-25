-- Additive customFields JSON bags for Custom Fields engine (tenant-scoped values).
-- Existing Contact/Deal.customFields unchanged.

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "customFields" JSONB NOT NULL DEFAULT '{}';
