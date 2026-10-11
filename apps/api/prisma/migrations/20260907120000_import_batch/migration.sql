-- ImportBatch: per CSV/Excel import run for New vs Old lead identification.
-- Additive only — existing Contact.importBatchId remains NULL (Old Leads).

CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "filename" TEXT,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportBatch_businessId_createdAt_idx" ON "ImportBatch"("businessId", "createdAt");
CREATE INDEX "ImportBatch_actorUserId_createdAt_idx" ON "ImportBatch"("actorUserId", "createdAt");

ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Contact" ADD COLUMN "importBatchId" TEXT;

CREATE INDEX "Contact_businessId_importBatchId_idx" ON "Contact"("businessId", "importBatchId");
CREATE INDEX "Contact_importBatchId_idx" ON "Contact"("importBatchId");

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
