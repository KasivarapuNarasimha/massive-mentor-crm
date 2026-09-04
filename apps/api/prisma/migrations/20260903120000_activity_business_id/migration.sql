-- AlterTable
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "businessId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Activity_businessId_createdAt_idx" ON "Activity"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "Activity_businessId_entityType_entityId_createdAt_idx" ON "Activity"("businessId", "entityType", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS "Activity_businessId_userId_createdAt_idx" ON "Activity"("businessId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Activity_entityType_entityId_createdAt_idx" ON "Activity"("entityType", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS "Activity_userId_createdAt_idx" ON "Activity"("userId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Activity" ADD CONSTRAINT "Activity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Best-effort backfill from Contact (no fabricated events — only scope existing Activity rows)
UPDATE "Activity" a
SET "businessId" = c."businessId"
FROM "Contact" c
WHERE a."entityType" IN ('contact', 'lead', 'client')
  AND a."entityId" = c."id"
  AND a."businessId" IS NULL
  AND c."businessId" IS NOT NULL;

UPDATE "Activity" a
SET "businessId" = d."businessId"
FROM "Deal" d
WHERE a."entityType" = 'deal'
  AND a."entityId" = d."id"
  AND a."businessId" IS NULL
  AND d."businessId" IS NOT NULL;