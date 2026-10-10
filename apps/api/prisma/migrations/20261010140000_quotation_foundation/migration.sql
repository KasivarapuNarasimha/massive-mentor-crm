-- Phase C foundation validated in disposable PostgreSQL run 38057228037.
-- Production application requires separate authorization; no data backfill.
-- IDs and updatedAt are supplied by Prisma/application, as declared in the schema.
BEGIN;
CREATE TABLE "QuotationSequence" (
 "businessId" TEXT NOT NULL, "year" INTEGER NOT NULL, "lastValue" INTEGER NOT NULL DEFAULT 0,
 CONSTRAINT "pc_quotationsequence_pk" PRIMARY KEY ("businessId","year"), CHECK ("year" BETWEEN 1 AND 9999), CHECK ("lastValue">=0)
);
CREATE TABLE "Quotation" (
 "id" TEXT CONSTRAINT "pc_quotation_pk" PRIMARY KEY, "businessId" TEXT NOT NULL, "number" TEXT NOT NULL,
 "creatorUserId" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "currentDraftRevisionId" TEXT, "effectiveSentRevisionId" TEXT,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "pc_quotation_u1" UNIQUE ("businessId","id"), CONSTRAINT "pc_quotation_u2" UNIQUE ("businessId","number"), CHECK ("version">0)
);
CREATE TABLE "QuotationRevision" (
 "id" TEXT CONSTRAINT "pc_quotationrevision_pk" PRIMARY KEY, "businessId" TEXT NOT NULL, "quotationId" TEXT NOT NULL,
 "revisionNumber" INTEGER NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "state" TEXT NOT NULL DEFAULT 'draft', "approvalState" TEXT NOT NULL DEFAULT 'unassessed',
 "contactId" TEXT NOT NULL, "dealId" TEXT, "timezone" TEXT NOT NULL, "currency" TEXT NOT NULL,
 "issueDate" TIMESTAMPTZ(3) NOT NULL, "validUntil" TIMESTAMPTZ(3) NOT NULL,
 "terms" TEXT NOT NULL, "notes" TEXT NOT NULL, "currentSnapshotId" TEXT, "sentAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "pc_quotationrevision_u1" UNIQUE ("businessId","quotationId","id"), CONSTRAINT "pc_quotationrevision_u2" UNIQUE ("businessId","id"),
 CONSTRAINT "pc_quotationrevision_u3" UNIQUE ("businessId","quotationId","revisionNumber"),
 CONSTRAINT "pc_quotationrevision_f1" FOREIGN KEY ("businessId","quotationId") REFERENCES "Quotation"("businessId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK ("revisionNumber">0 AND "version">0), CHECK ("validUntil">="issueDate"),
 CHECK ("currency" ~ '^[A-Z]{3}$'),
 CHECK ("state" IN ('draft','sent','expired','withdrawn','superseded')),
 CHECK ("state" <> 'sent' OR "sentAt" IS NOT NULL),
 CHECK ("state" <> 'draft' OR "sentAt" IS NULL),
 CHECK ("state" <> 'superseded' OR "sentAt" IS NOT NULL),
 CHECK ("sentAt" IS NULL OR "currentSnapshotId" IS NOT NULL),
 CHECK ("approvalState" IN ('unassessed','not_required','required','pending','approved','rejected','stale'))
);
CREATE TABLE "QuotationPricingSnapshot" (
 "id" TEXT CONSTRAINT "pc_quotationpricingsnapshot_pk" PRIMARY KEY, "businessId" TEXT NOT NULL, "revisionId" TEXT NOT NULL, "revisionVersion" INTEGER NOT NULL,
 "pricingVersion" TEXT NOT NULL, "policyVersion" TEXT NOT NULL,
 "policySnapshot" JSONB NOT NULL, "customerSnapshot" JSONB NOT NULL,
 "canonicalInput" JSONB NOT NULL, "pricingOutput" JSONB NOT NULL, "contentHash" TEXT NOT NULL,
 "hashVersion" TEXT NOT NULL, "expectedItemCount" INTEGER NOT NULL, "sealedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "pc_quotationpricingsnapshot_u1" UNIQUE ("businessId","revisionId","id"), CONSTRAINT "pc_quotationpricingsnapshot_u2" UNIQUE ("businessId","id"), CONSTRAINT "pc_quotationpricingsnapshot_u3" UNIQUE ("businessId","revisionId","revisionVersion"),
 CONSTRAINT "pc_quotationpricingsnapshot_f1" FOREIGN KEY ("businessId","revisionId") REFERENCES "QuotationRevision"("businessId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK ("expectedItemCount">0), CHECK ("hashVersion" = 'mm-commercial-content-v1'),
 CHECK ("revisionVersion">0), CHECK ("contentHash" ~ '^[0-9a-f]{64}$')
);
CREATE TABLE "QuotationRevisionItem" (
 "id" TEXT CONSTRAINT "pc_quotationrevisionitem_pk" PRIMARY KEY, "businessId" TEXT NOT NULL, "snapshotId" TEXT NOT NULL, "position" VARCHAR(32) NOT NULL,
 "description" TEXT NOT NULL, "quantity" DECIMAL(18,4) NOT NULL, "unitPrice" DECIMAL(18,2) NOT NULL,
 "taxRate" DECIMAL(8,4) NOT NULL, "discountInput" JSONB NOT NULL, "calculation" JSONB NOT NULL,
 CONSTRAINT "pc_quotationrevisionitem_u1" UNIQUE ("businessId","snapshotId","position"),
 CONSTRAINT "pc_quotationrevisionitem_f1" FOREIGN KEY ("businessId","snapshotId") REFERENCES "QuotationPricingSnapshot"("businessId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK ("position" ~ '^(0|[1-9][0-9]*)$'), CHECK ("quantity">0), CHECK ("unitPrice">=0), CHECK ("taxRate">=0)
);
CREATE TABLE "QuotationApprovalHistory" (
 "id" TEXT CONSTRAINT "pc_quotationapprovalhistory_pk" PRIMARY KEY, "businessId" TEXT NOT NULL, "snapshotId" TEXT NOT NULL, "actorUserId" TEXT NOT NULL,
 "event" TEXT NOT NULL, "reason" TEXT NOT NULL, "metadata" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "pc_quotationapprovalhistory_f1" FOREIGN KEY ("businessId","snapshotId") REFERENCES "QuotationPricingSnapshot"("businessId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "QuotationEvent" (
 "id" TEXT CONSTRAINT "pc_quotationevent_pk" PRIMARY KEY, "businessId" TEXT NOT NULL, "snapshotId" TEXT NOT NULL, "actorUserId" TEXT NOT NULL,
 "event" TEXT NOT NULL, "metadata" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "pc_quotationevent_f1" FOREIGN KEY ("businessId","snapshotId") REFERENCES "QuotationPricingSnapshot"("businessId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "CommercialMutationRequest" (
 "id" TEXT CONSTRAINT "pc_commercialmutationrequest_pk" PRIMARY KEY, "businessId" TEXT NOT NULL, "actorUserId" TEXT NOT NULL,
 "operation" TEXT NOT NULL, "key" VARCHAR(128) NOT NULL, "requestHash" TEXT NOT NULL, "result" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "pc_commercialmutationrequest_u1" UNIQUE ("businessId","actorUserId","operation","key"),
 CHECK (length("key")>0), CHECK ("requestHash" ~ '^[0-9a-f]{64}$')
);
ALTER TABLE "Quotation" ADD CONSTRAINT "pc_quotation_f1" FOREIGN KEY ("businessId","id","currentDraftRevisionId")
 REFERENCES "QuotationRevision"("businessId","quotationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Quotation" ADD CONSTRAINT "pc_quotation_f2" FOREIGN KEY ("businessId","id","effectiveSentRevisionId")
 REFERENCES "QuotationRevision"("businessId","quotationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "QuotationRevision" ADD CONSTRAINT "pc_quotationrevision_f2" FOREIGN KEY ("businessId","id","currentSnapshotId")
 REFERENCES "QuotationPricingSnapshot"("businessId","revisionId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX "pc_quotation_i1" ON "Quotation"("businessId","ownerUserId","createdAt");
CREATE INDEX "pc_quotationrevision_i1" ON "QuotationRevision"("businessId","contactId");
CREATE INDEX "pc_quotationapprovalhistory_i1" ON "QuotationApprovalHistory"("businessId","snapshotId","createdAt");
CREATE INDEX "pc_quotationevent_i1" ON "QuotationEvent"("businessId","snapshotId","createdAt");

-- Immutable snapshot rows/items, history and committed idempotency responses.
CREATE FUNCTION mm_commercial_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'COMMERCIAL_HISTORY_IMMUTABLE'; END;
$$;
-- The only permitted snapshot UPDATE is one-way sealing, with all content unchanged.
CREATE FUNCTION mm_commercial_snapshot_seal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_state TEXT; parent_sent_at TIMESTAMPTZ; parent_version INTEGER; item_count BIGINT;
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'COMMERCIAL_HISTORY_IMMUTABLE'; END IF;
 IF OLD."sealedAt" IS NOT NULL OR NEW."sealedAt" IS NULL OR
    (to_jsonb(NEW) - 'sealedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'sealedAt') THEN
   RAISE EXCEPTION 'COMMERCIAL_HISTORY_IMMUTABLE';
 END IF;
 SELECT "state", "sentAt", "version" INTO parent_state, parent_sent_at, parent_version
 FROM "QuotationRevision" WHERE "businessId"=NEW."businessId" AND "id"=NEW."revisionId" FOR UPDATE;
 SELECT count(*) INTO item_count FROM "QuotationRevisionItem"
 WHERE "businessId"=NEW."businessId" AND "snapshotId"=NEW."id";
 IF parent_state IS DISTINCT FROM 'draft' OR parent_sent_at IS NOT NULL OR
    parent_version IS DISTINCT FROM NEW."revisionVersion" OR item_count <> NEW."expectedItemCount" THEN
   RAISE EXCEPTION 'COMMERCIAL_SNAPSHOT_INCOMPLETE';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER mm_snapshot_immutable BEFORE UPDATE OR DELETE ON "QuotationPricingSnapshot" FOR EACH ROW EXECUTE FUNCTION mm_commercial_snapshot_seal_guard();
-- No incomplete snapshot may survive commit. Query final row rather than INSERT's NEW.
CREATE FUNCTION mm_commercial_snapshot_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "QuotationPricingSnapshot" WHERE "id"=NEW."id" AND "sealedAt" IS NULL) THEN
   RAISE EXCEPTION 'COMMERCIAL_SNAPSHOT_INCOMPLETE';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER mm_snapshot_complete AFTER INSERT ON "QuotationPricingSnapshot"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mm_commercial_snapshot_complete();
CREATE TRIGGER mm_item_immutable BEFORE UPDATE OR DELETE ON "QuotationRevisionItem" FOR EACH ROW EXECUTE FUNCTION mm_commercial_append_only();
CREATE TRIGGER mm_approval_immutable BEFORE UPDATE OR DELETE ON "QuotationApprovalHistory" FOR EACH ROW EXECUTE FUNCTION mm_commercial_append_only();
CREATE TRIGGER mm_event_immutable BEFORE UPDATE OR DELETE ON "QuotationEvent" FOR EACH ROW EXECUTE FUNCTION mm_commercial_append_only();
CREATE TRIGGER mm_request_immutable BEFORE UPDATE OR DELETE ON "CommercialMutationRequest" FOR EACH ROW EXECUTE FUNCTION mm_commercial_append_only();
-- Freeze revision payload after sending; allow only later lifecycle/approval metadata.
CREATE FUNCTION mm_commercial_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'COMMERCIAL_REVISION_RETAINED'; END IF;
 IF (OLD."sentAt" IS NOT NULL OR OLD."state" <> 'draft') AND
   (to_jsonb(NEW) - ARRAY['state','approvalState','version','updatedAt']) IS DISTINCT FROM
   (to_jsonb(OLD) - ARRAY['state','approvalState','version','updatedAt']) THEN
   RAISE EXCEPTION 'SENT_REVISION_IMMUTABLE';
 END IF;
 IF (OLD."sentAt" IS NOT NULL OR OLD."state" <> 'draft') AND NEW."state" = 'draft' THEN RAISE EXCEPTION 'SENT_REVISION_IMMUTABLE'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER mm_revision_guard BEFORE UPDATE OR DELETE ON "QuotationRevision" FOR EACH ROW EXECUTE FUNCTION mm_commercial_revision_guard();
-- Prevent extra snapshots/items from changing a terminal or previously sent revision.
-- Locks serialize these insert checks against revision sending/state transitions.
CREATE FUNCTION mm_commercial_content_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_state TEXT; parent_sent_at TIMESTAMPTZ; snapshot_sealed_at TIMESTAMPTZ;
BEGIN
 IF TG_TABLE_NAME = 'QuotationPricingSnapshot' THEN
   SELECT "state", "sentAt" INTO parent_state, parent_sent_at FROM "QuotationRevision"
   WHERE "businessId"=NEW."businessId" AND "id"=NEW."revisionId" FOR UPDATE;
   IF NEW."sealedAt" IS NOT NULL THEN RAISE EXCEPTION 'COMMERCIAL_SNAPSHOT_PRESEALED'; END IF;
 ELSE
   -- Revision first, then snapshot: services must use this lock order for sealing.
   SELECT r."state", r."sentAt" INTO parent_state, parent_sent_at
   FROM "QuotationRevision" r JOIN "QuotationPricingSnapshot" s
   ON r."businessId"=s."businessId" AND r."id"=s."revisionId"
   WHERE s."businessId"=NEW."businessId" AND s."id"=NEW."snapshotId" FOR UPDATE OF r;
   SELECT "sealedAt" INTO snapshot_sealed_at FROM "QuotationPricingSnapshot"
   WHERE "businessId"=NEW."businessId" AND "id"=NEW."snapshotId" FOR UPDATE;
   IF snapshot_sealed_at IS NOT NULL THEN RAISE EXCEPTION 'COMMERCIAL_SNAPSHOT_SEALED'; END IF;
 END IF;
 IF parent_state IS NULL OR parent_state <> 'draft' OR parent_sent_at IS NOT NULL THEN
   RAISE EXCEPTION 'COMMERCIAL_CONTENT_INSERT_FORBIDDEN';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER mm_snapshot_insert_guard BEFORE INSERT ON "QuotationPricingSnapshot" FOR EACH ROW EXECUTE FUNCTION mm_commercial_content_insert_guard();
CREATE TRIGGER mm_item_insert_guard BEFORE INSERT ON "QuotationRevisionItem" FOR EACH ROW EXECUTE FUNCTION mm_commercial_content_insert_guard();
-- Sending cannot point to an incomplete or wrong-version snapshot, even on INSERT.
CREATE FUNCTION mm_commercial_sent_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."sentAt" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."sentAt" IS NULL) AND NOT EXISTS (
   SELECT 1 FROM "QuotationPricingSnapshot" s WHERE s."businessId"=NEW."businessId"
   AND s."revisionId"=NEW."id" AND s."id"=NEW."currentSnapshotId"
   AND s."sealedAt" IS NOT NULL AND s."revisionVersion"=NEW."version"
 ) THEN RAISE EXCEPTION 'COMMERCIAL_SENT_SNAPSHOT_INVALID'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER mm_sent_snapshot_guard BEFORE INSERT OR UPDATE ON "QuotationRevision"
 FOR EACH ROW EXECUTE FUNCTION mm_commercial_sent_snapshot_guard();
-- No changes to Business/User/Contact/Deal/Invoice/Payment or existing sequences.
COMMIT;
