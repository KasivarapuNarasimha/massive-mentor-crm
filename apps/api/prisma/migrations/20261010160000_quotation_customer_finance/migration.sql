-- Additive customer verification / financial ledger. Not approved for production execution.
BEGIN;
ALTER TABLE "QuotationRevision" DROP CONSTRAINT "QuotationRevision_state_check";
ALTER TABLE "QuotationRevision" ADD CONSTRAINT "QuotationRevision_state_check" CHECK ("state" IN ('draft','sent','expired','withdrawn','superseded','accepted','rejected'));
CREATE FUNCTION mm_commercial_terminal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."version"<OLD."version" THEN RAISE EXCEPTION 'COMMERCIAL_VERSION_REGRESSION'; END IF;
 IF OLD."state" IN ('expired','withdrawn','superseded','accepted','rejected') AND NEW."state"<>OLD."state" THEN RAISE EXCEPTION 'COMMERCIAL_TERMINAL_REACTIVATION'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER mm_terminal_guard BEFORE UPDATE ON "QuotationRevision" FOR EACH ROW EXECUTE FUNCTION mm_commercial_terminal_guard();

CREATE TABLE "QuotationCustomerAccess" (
 "id" TEXT PRIMARY KEY,"businessId" TEXT NOT NULL,"snapshotId" TEXT NOT NULL,"quotationId" TEXT NOT NULL,"revisionId" TEXT NOT NULL,"senderUserId" TEXT NOT NULL,
 "tokenHash" TEXT NOT NULL UNIQUE CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),"policy" JSONB NOT NULL,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,"deliveredAt" TIMESTAMPTZ(3),"revokedAt" TIMESTAMPTZ(3),"consumedAt" TIMESTAMPTZ(3),"decision" TEXT CHECK ("decision" IN ('accepted','rejected')),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("businessId","id"),
 FOREIGN KEY ("businessId","snapshotId") REFERENCES "QuotationPricingSnapshot"("businessId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("businessId","revisionId","snapshotId") REFERENCES "QuotationPricingSnapshot"("businessId","revisionId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("businessId","quotationId","revisionId") REFERENCES "QuotationRevision"("businessId","quotationId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK (("consumedAt" IS NULL)=("decision" IS NULL)));
CREATE INDEX "QuotationCustomerAccess_businessId_revisionId_idx" ON "QuotationCustomerAccess"("businessId","revisionId");
CREATE UNIQUE INDEX "mm_customer_access_active_revision" ON "QuotationCustomerAccess"("businessId","revisionId") WHERE "revokedAt" IS NULL;
CREATE TABLE "QuotationOtpChallenge" (
 "id" TEXT PRIMARY KEY,"businessId" TEXT NOT NULL,"accessId" TEXT NOT NULL UNIQUE,"version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
 "codeHash" TEXT NOT NULL CHECK ("codeHash" ~ '^[0-9a-f]{64}$'),"action" TEXT NOT NULL CHECK ("action" IN ('accepted','rejected')),
 "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts">=0),"sendCount" INTEGER NOT NULL DEFAULT 1 CHECK ("sendCount">0),
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,"lastSentAt" TIMESTAMPTZ(3) NOT NULL,"deliveredAt" TIMESTAMPTZ(3),"usedAt" TIMESTAMPTZ(3),
 UNIQUE("businessId","id"),UNIQUE("businessId","accessId"),FOREIGN KEY ("businessId","accessId") REFERENCES "QuotationCustomerAccess"("businessId","id") ON DELETE RESTRICT ON UPDATE RESTRICT);
CREATE TABLE "CommercialDelivery" (
 "id" TEXT PRIMARY KEY,"businessId" TEXT NOT NULL,"accessId" TEXT NOT NULL,"kind" TEXT NOT NULL CHECK ("kind" IN ('link','otp')),"challengeVersion" INTEGER,
 "payload" TEXT,"state" TEXT NOT NULL DEFAULT 'queued' CHECK ("state" IN ('queued','sending','delivered','failed')),"attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts">=0),
 "leaseUntil" TIMESTAMPTZ(3),"deliveredAt" TIMESTAMPTZ(3),"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("businessId","accessId") REFERENCES "QuotationCustomerAccess"("businessId","id") ON DELETE RESTRICT ON UPDATE RESTRICT);
CREATE INDEX "CommercialDelivery_businessId_accessId_state_idx" ON "CommercialDelivery"("businessId","accessId","state");
CREATE TABLE "QuotationInvoiceConversion" (
 "id" TEXT PRIMARY KEY,"businessId" TEXT NOT NULL,"quotationId" TEXT NOT NULL,"snapshotId" TEXT NOT NULL,"revisionId" TEXT NOT NULL,"invoiceId" TEXT NOT NULL UNIQUE,
 "customerSnapshot" JSONB NOT NULL,"pricingSnapshot" JSONB NOT NULL,"acceptedAt" TIMESTAMPTZ(3) NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("businessId","quotationId"),UNIQUE("businessId","invoiceId"),
 FOREIGN KEY ("businessId","revisionId","snapshotId") REFERENCES "QuotationPricingSnapshot"("businessId","revisionId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("businessId","quotationId","revisionId") REFERENCES "QuotationRevision"("businessId","quotationId","id") ON DELETE RESTRICT ON UPDATE RESTRICT);
CREATE TABLE "CommercialPaymentEntry" (
 "id" TEXT PRIMARY KEY,"businessId" TEXT NOT NULL,"invoiceId" TEXT NOT NULL,"paymentId" TEXT UNIQUE,"actorUserId" TEXT NOT NULL,
 "amount" DECIMAL(18,2) NOT NULL CHECK ("amount">0),"method" TEXT NOT NULL CHECK ("method" IN ('bank','cash','upi','card','other')),
 "reference" TEXT,"notes" TEXT NOT NULL,"paidAt" TIMESTAMPTZ(3) NOT NULL,"reversalOfId" TEXT UNIQUE,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("businessId","id"),FOREIGN KEY ("businessId","invoiceId") REFERENCES "QuotationInvoiceConversion"("businessId","invoiceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("businessId","reversalOfId") REFERENCES "CommercialPaymentEntry"("businessId","id") ON DELETE RESTRICT ON UPDATE RESTRICT);
CREATE INDEX "CommercialPaymentEntry_businessId_invoiceId_createdAt_idx" ON "CommercialPaymentEntry"("businessId","invoiceId","createdAt");
CREATE TRIGGER mm_conversion_immutable BEFORE UPDATE OR DELETE ON "QuotationInvoiceConversion" FOR EACH ROW EXECUTE FUNCTION mm_commercial_append_only();
CREATE TRIGGER mm_payment_entry_immutable BEFORE UPDATE OR DELETE ON "CommercialPaymentEntry" FOR EACH ROW EXECUTE FUNCTION mm_commercial_append_only();
-- Restrict legacy mutation paths without changing their non-commercial behavior.
CREATE FUNCTION mm_commercial_finance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE commercial BOOLEAN; invoice_id TEXT; business_id TEXT; linked_deal TEXT;
BEGIN
 IF TG_TABLE_NAME='Invoice' THEN
  IF TG_OP='DELETE' THEN commercial:=OLD."sourceType"='quotation'; ELSE commercial:=NEW."sourceType"='quotation' OR (TG_OP='UPDATE' AND OLD."sourceType"='quotation'); END IF;
 ELSE
  IF TG_OP='DELETE' THEN invoice_id:=OLD."invoiceId"; business_id:=OLD."businessId"; ELSE invoice_id:=NEW."invoiceId"; business_id:=NEW."businessId"; END IF;
  SELECT "sourceType"='quotation' INTO commercial FROM "Invoice" WHERE "id"=invoice_id;
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM "Invoice" WHERE "id"=OLD."invoiceId" AND "sourceType"='quotation') THEN commercial:=TRUE; END IF;
 END IF;
 IF TG_TABLE_NAME='Invoice' AND TG_OP<>'DELETE' THEN
  IF NEW."sourceType"='deal' THEN linked_deal:=NEW."sourceId";
  ELSIF NEW."sourceType"='quotation' THEN linked_deal:=NEW."customFields"->'commercial'->>'dealId'; END IF;
  IF linked_deal IS NOT NULL THEN
   -- Serialize finance issuance across the old Deal path and new quotation path.
   PERFORM pg_advisory_xact_lock(hashtext(NEW."businessId"),hashtext('commercial-deal:'||linked_deal));
   IF NEW."sourceType"='deal' AND EXISTS(SELECT 1 FROM "QuotationRevision" r JOIN "Quotation" q ON q."businessId"=r."businessId" AND q."id"=r."quotationId" WHERE r."businessId"=NEW."businessId" AND r."dealId"=linked_deal AND q."effectiveSentRevisionId"=r."id" AND r."state" IN ('sent','accepted')) THEN RAISE EXCEPTION 'COMMERCIAL_DEAL_FINANCE_ROUTE_REQUIRED'; END IF;
   IF NEW."sourceType"='quotation' AND EXISTS(SELECT 1 FROM "Invoice" WHERE "businessId"=NEW."businessId" AND "sourceType"='deal' AND "sourceId"=linked_deal AND "status"<>'cancelled') THEN RAISE EXCEPTION 'EXISTING_DEAL_FINANCE_RECONCILIATION_REQUIRED'; END IF;
  END IF;
 END IF;
 IF commercial THEN
  IF TG_TABLE_NAME='Invoice' AND TG_OP='DELETE' THEN RAISE EXCEPTION 'COMMERCIAL_INVOICE_RETAINED'; END IF;
  IF current_setting('mm.commercial_write',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'COMMERCIAL_FINANCE_ROUTE_REQUIRED'; END IF;
  IF TG_TABLE_NAME='Invoice' AND TG_OP='UPDATE' AND
    (to_jsonb(NEW)-ARRAY['status','paidAt','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','paidAt','updatedAt']) THEN RAISE EXCEPTION 'COMMERCIAL_INVOICE_IMMUTABLE'; END IF;
  IF TG_TABLE_NAME='Payment' AND NOT EXISTS(SELECT 1 FROM "Invoice" WHERE "id"=invoice_id AND "businessId"=business_id AND "sourceType"='quotation') THEN RAISE EXCEPTION 'COMMERCIAL_PAYMENT_TENANT_MISMATCH'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER mm_commercial_invoice_guard BEFORE INSERT OR UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION mm_commercial_finance_guard();
CREATE TRIGGER mm_commercial_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION mm_commercial_finance_guard();
COMMIT;
