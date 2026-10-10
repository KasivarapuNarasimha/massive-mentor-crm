-- Future disposable CI only; run.sh must establish identity first.
\set ON_ERROR_STOP on
SET statement_timeout='10s';
SET lock_timeout='4s';
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE TEMP TABLE negative_probe(label text NOT NULL);
CREATE FUNCTION pg_temp.fixture_fingerprint() RETURNS text LANGUAGE plpgsql AS $$
DECLARE tab text; part text; combined text := '';
BEGIN
 FOREACH tab IN ARRAY ARRAY['QuotationSequence','Quotation','QuotationRevision','QuotationPricingSnapshot','QuotationRevisionItem','QuotationApprovalHistory','QuotationEvent','CommercialMutationRequest'] LOOP
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'') FROM %I t',tab) INTO part;
  combined := combined || tab || part;
 END LOOP;
 RETURN md5(combined);
END $$;
CREATE FUNCTION pg_temp.reject(command text,wanted text,label text,expected_class text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text; detail text; constraint_name text; before_state text; expression text;
BEGIN
 before_state := pg_temp.fixture_fingerprint();
 BEGIN
  INSERT INTO negative_probe VALUES (label);
  EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS got=RETURNED_SQLSTATE,detail=MESSAGE_TEXT,constraint_name=CONSTRAINT_NAME;
  IF got<>wanted THEN RAISE EXCEPTION 'FAIL: % SQLSTATE mismatch',label; END IF;
  IF expected_class LIKE 'constraint:%' THEN
   IF constraint_name IS DISTINCT FROM substring(expected_class FROM 12) THEN RAISE EXCEPTION 'FAIL: % constraint mismatch',label; END IF;
  ELSIF expected_class LIKE 'check:%' THEN
   -- Exact intended column, table, and CHECK type, not any 23514 error.
   IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.conname=constraint_name AND c.conrelid=to_regclass(format('public.%I',split_part(expected_class,':',2)))
    AND c.contype='c' AND a.attname=split_part(expected_class,':',3)) THEN
    RAISE EXCEPTION 'FAIL: % check class mismatch',label;
   END IF;
  ELSIF expected_class LIKE 'checkexpr:%' THEN
   SELECT pg_get_constraintdef(c.oid) INTO expression FROM pg_constraint c
   WHERE c.conname=constraint_name AND c.conrelid=to_regclass(format('public.%I',split_part(expected_class,':',2))) AND c.contype='c';
   IF expression IS NULL OR strpos(expression,substring(expected_class FROM length(split_part(expected_class,':',2))+12))=0 THEN
    RAISE EXCEPTION 'FAIL: % lifecycle check mismatch',label;
   END IF;
  ELSIF expected_class NOT IN ('COMMERCIAL_HISTORY_IMMUTABLE','COMMERCIAL_SNAPSHOT_INCOMPLETE','COMMERCIAL_SNAPSHOT_PRESEALED','COMMERCIAL_CONTENT_INSERT_FORBIDDEN','COMMERCIAL_SNAPSHOT_SEALED','COMMERCIAL_SENT_SNAPSHOT_INVALID','SENT_REVISION_IMMUTABLE','COMMERCIAL_REVISION_RETAINED') OR detail IS DISTINCT FROM expected_class THEN
   RAISE EXCEPTION 'FAIL: % message class mismatch',label;
  END IF;
  IF EXISTS (SELECT 1 FROM negative_probe p WHERE p.label=reject.label) OR pg_temp.fixture_fingerprint() IS DISTINCT FROM before_state THEN
   RAISE EXCEPTION 'FAIL: % subtransaction rollback mismatch',label;
  END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'FAIL: % unexpectedly succeeded',label;
END $$;
SELECT pg_temp.assert_true((SELECT count(*)=8 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'),'eight tables');
SELECT pg_temp.assert_true((SELECT count(*)=8 FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='p'),'eight primary keys');
SELECT pg_temp.assert_true((SELECT count(*)=10 FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='u'),'ten unique keys');
SELECT pg_temp.assert_true((SELECT count(*)=8 FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f'),'eight FKs');
SELECT pg_temp.assert_true((SELECT count(*)=4 FROM pg_indexes WHERE schemaname='public' AND indexname IN ('pc_quotation_i1','pc_quotationrevision_i1','pc_quotationapprovalhistory_i1','pc_quotationevent_i1')),'four secondary indexes');
WITH expected(name,child,parent,columns,targets,action) AS (VALUES
 ('pc_quotation_f1','Quotation','QuotationRevision',ARRAY['businessId','id','currentDraftRevisionId'],ARRAY['businessId','quotationId','id'],'a'),
 ('pc_quotation_f2','Quotation','QuotationRevision',ARRAY['businessId','id','effectiveSentRevisionId'],ARRAY['businessId','quotationId','id'],'a'),
 ('pc_quotationrevision_f1','QuotationRevision','Quotation',ARRAY['businessId','quotationId'],ARRAY['businessId','id'],'r'),
 ('pc_quotationrevision_f2','QuotationRevision','QuotationPricingSnapshot',ARRAY['businessId','id','currentSnapshotId'],ARRAY['businessId','revisionId','id'],'a'),
 ('pc_quotationpricingsnapshot_f1','QuotationPricingSnapshot','QuotationRevision',ARRAY['businessId','revisionId'],ARRAY['businessId','id'],'r'),
 ('pc_quotationrevisionitem_f1','QuotationRevisionItem','QuotationPricingSnapshot',ARRAY['businessId','snapshotId'],ARRAY['businessId','id'],'r'),
 ('pc_quotationapprovalhistory_f1','QuotationApprovalHistory','QuotationPricingSnapshot',ARRAY['businessId','snapshotId'],ARRAY['businessId','id'],'r'),
 ('pc_quotationevent_f1','QuotationEvent','QuotationPricingSnapshot',ARRAY['businessId','snapshotId'],ARRAY['businessId','id'],'r'))
SELECT pg_temp.assert_true(count(*)=8 AND bool_and(c.oid IS NOT NULL AND
 c.conrelid=to_regclass(format('public.%I',e.child)) AND c.confrelid=to_regclass(format('public.%I',e.parent))
 AND c.confdeltype::text=e.action AND c.confupdtype::text=e.action
 AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num)=e.columns
 AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num)=e.targets),'FK order/targets/actions')
FROM expected e LEFT JOIN pg_constraint c ON c.connamespace='public'::regnamespace AND c.conname=e.name;
SELECT pg_temp.assert_true((SELECT count(*)=10 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled='O'),'ten enabled triggers');
SELECT pg_temp.assert_true((SELECT tgdeferrable AND tginitdeferred FROM pg_trigger WHERE tgname='mm_snapshot_complete'),'deferred completeness');
SELECT pg_temp.assert_true((SELECT numeric_precision=18 AND numeric_scale=4 FROM information_schema.columns WHERE table_schema='public' AND table_name='QuotationRevisionItem' AND column_name='quantity'),'quantity precision');
SELECT pg_temp.assert_true((SELECT numeric_precision=18 AND numeric_scale=2 FROM information_schema.columns WHERE table_schema='public' AND table_name='QuotationRevisionItem' AND column_name='unitPrice'),'money precision');
SELECT pg_temp.assert_true((SELECT numeric_precision=8 AND numeric_scale=4 FROM information_schema.columns WHERE table_schema='public' AND table_name='QuotationRevisionItem' AND column_name='taxRate'),'tax precision');

-- Exact trigger metadata, not a count-only proxy. tgtype is PostgreSQL's event mask.
WITH expected(name,tab,fn,type,deferred) AS (VALUES
 ('mm_snapshot_immutable','QuotationPricingSnapshot','mm_commercial_snapshot_seal_guard',27,false),
 ('mm_snapshot_complete','QuotationPricingSnapshot','mm_commercial_snapshot_complete',5,true),
 ('mm_item_immutable','QuotationRevisionItem','mm_commercial_append_only',27,false),
 ('mm_approval_immutable','QuotationApprovalHistory','mm_commercial_append_only',27,false),
 ('mm_event_immutable','QuotationEvent','mm_commercial_append_only',27,false),
 ('mm_request_immutable','CommercialMutationRequest','mm_commercial_append_only',27,false),
 ('mm_revision_guard','QuotationRevision','mm_commercial_revision_guard',27,false),
 ('mm_snapshot_insert_guard','QuotationPricingSnapshot','mm_commercial_content_insert_guard',7,false),
 ('mm_item_insert_guard','QuotationRevisionItem','mm_commercial_content_insert_guard',7,false),
 ('mm_sent_snapshot_guard','QuotationRevision','mm_commercial_sent_snapshot_guard',23,false))
SELECT pg_temp.assert_true(count(*)=10 AND bool_and(t.oid IS NOT NULL AND t.tgenabled='O'
 AND t.tgtype=e.type AND t.tgfoid=to_regprocedure(format('public.%I()',e.fn))
 AND t.tgdeferrable=e.deferred AND t.tginitdeferred=e.deferred
 AND ((t.tgconstraint<>0)=e.deferred) AND t.tgnargs=0 AND t.tgqual IS NULL AND t.tgattr::text=''),
 'exact trigger timing/events/function/enabled/deferred metadata')
FROM expected e LEFT JOIN pg_trigger t ON t.tgname=e.name AND t.tgrelid=to_regclass(format('public.%I',e.tab)) AND NOT t.tgisinternal;

-- Fixed manifest captured from the reviewed proposal; not regenerated at CI runtime.
WITH expected(tab,col,typ,nn,def) AS (VALUES
('QuotationSequence','businessId','text',true,NULL),
('QuotationSequence','year','integer',true,NULL),
('QuotationSequence','lastValue','integer',true,'0'),
('Quotation','id','text',true,NULL),
('Quotation','businessId','text',true,NULL),
('Quotation','number','text',true,NULL),
('Quotation','creatorUserId','text',true,NULL),
('Quotation','ownerUserId','text',true,NULL),
('Quotation','version','integer',true,'1'),
('Quotation','currentDraftRevisionId','text',false,NULL),
('Quotation','effectiveSentRevisionId','text',false,NULL),
('Quotation','createdAt','timestamp(3) with time zone',true,'CURRENT_TIMESTAMP'),
('Quotation','updatedAt','timestamp(3) with time zone',true,NULL),
('QuotationRevision','id','text',true,NULL),
('QuotationRevision','businessId','text',true,NULL),
('QuotationRevision','quotationId','text',true,NULL),
('QuotationRevision','revisionNumber','integer',true,NULL),
('QuotationRevision','version','integer',true,'1'),
('QuotationRevision','state','text',true,'''draft''::text'),
('QuotationRevision','approvalState','text',true,'''unassessed''::text'),
('QuotationRevision','contactId','text',true,NULL),
('QuotationRevision','dealId','text',false,NULL),
('QuotationRevision','timezone','text',true,NULL),
('QuotationRevision','currency','text',true,NULL),
('QuotationRevision','issueDate','timestamp(3) with time zone',true,NULL),
('QuotationRevision','validUntil','timestamp(3) with time zone',true,NULL),
('QuotationRevision','terms','text',true,NULL),
('QuotationRevision','notes','text',true,NULL),
('QuotationRevision','currentSnapshotId','text',false,NULL),
('QuotationRevision','sentAt','timestamp(3) with time zone',false,NULL),
('QuotationRevision','createdAt','timestamp(3) with time zone',true,'CURRENT_TIMESTAMP'),
('QuotationRevision','updatedAt','timestamp(3) with time zone',true,NULL),
('QuotationPricingSnapshot','id','text',true,NULL),
('QuotationPricingSnapshot','businessId','text',true,NULL),
('QuotationPricingSnapshot','revisionId','text',true,NULL),
('QuotationPricingSnapshot','revisionVersion','integer',true,NULL),
('QuotationPricingSnapshot','pricingVersion','text',true,NULL),
('QuotationPricingSnapshot','policyVersion','text',true,NULL),
('QuotationPricingSnapshot','policySnapshot','jsonb',true,NULL),
('QuotationPricingSnapshot','customerSnapshot','jsonb',true,NULL),
('QuotationPricingSnapshot','canonicalInput','jsonb',true,NULL),
('QuotationPricingSnapshot','pricingOutput','jsonb',true,NULL),
('QuotationPricingSnapshot','contentHash','text',true,NULL),
('QuotationPricingSnapshot','hashVersion','text',true,NULL),
('QuotationPricingSnapshot','expectedItemCount','integer',true,NULL),
('QuotationPricingSnapshot','sealedAt','timestamp(3) with time zone',false,NULL),
('QuotationPricingSnapshot','createdAt','timestamp(3) with time zone',true,'CURRENT_TIMESTAMP'),
('QuotationRevisionItem','id','text',true,NULL),
('QuotationRevisionItem','businessId','text',true,NULL),
('QuotationRevisionItem','snapshotId','text',true,NULL),
('QuotationRevisionItem','position','character varying(32)',true,NULL),
('QuotationRevisionItem','description','text',true,NULL),
('QuotationRevisionItem','quantity','numeric(18,4)',true,NULL),
('QuotationRevisionItem','unitPrice','numeric(18,2)',true,NULL),
('QuotationRevisionItem','taxRate','numeric(8,4)',true,NULL),
('QuotationRevisionItem','discountInput','jsonb',true,NULL),
('QuotationRevisionItem','calculation','jsonb',true,NULL),
('QuotationApprovalHistory','id','text',true,NULL),
('QuotationApprovalHistory','businessId','text',true,NULL),
('QuotationApprovalHistory','snapshotId','text',true,NULL),
('QuotationApprovalHistory','actorUserId','text',true,NULL),
('QuotationApprovalHistory','event','text',true,NULL),
('QuotationApprovalHistory','reason','text',true,NULL),
('QuotationApprovalHistory','metadata','jsonb',true,NULL),
('QuotationApprovalHistory','createdAt','timestamp(3) with time zone',true,'CURRENT_TIMESTAMP'),
('QuotationEvent','id','text',true,NULL),
('QuotationEvent','businessId','text',true,NULL),
('QuotationEvent','snapshotId','text',true,NULL),
('QuotationEvent','actorUserId','text',true,NULL),
('QuotationEvent','event','text',true,NULL),
('QuotationEvent','metadata','jsonb',true,NULL),
('QuotationEvent','createdAt','timestamp(3) with time zone',true,'CURRENT_TIMESTAMP'),
('CommercialMutationRequest','id','text',true,NULL),
('CommercialMutationRequest','businessId','text',true,NULL),
('CommercialMutationRequest','actorUserId','text',true,NULL),
('CommercialMutationRequest','operation','text',true,NULL),
('CommercialMutationRequest','key','character varying(128)',true,NULL),
('CommercialMutationRequest','requestHash','text',true,NULL),
('CommercialMutationRequest','result','jsonb',true,NULL),
('CommercialMutationRequest','createdAt','timestamp(3) with time zone',true,'CURRENT_TIMESTAMP'))
SELECT pg_temp.assert_true(count(*)=80 AND bool_and(a.attnum IS NOT NULL AND format_type(a.atttypid,a.atttypmod)=e.typ AND a.attnotnull=e.nn AND pg_get_expr(d.adbin,d.adrelid) IS NOT DISTINCT FROM e.def),'all scalar types/nullability/defaults') FROM expected e LEFT JOIN pg_attribute a ON a.attrelid=to_regclass(format('public.%I',e.tab)) AND a.attname=e.col AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum;
WITH expected(tab,name,kind,cols) AS (VALUES
('QuotationSequence','pc_quotationsequence_pk','p',ARRAY['businessId','year']),
('Quotation','pc_quotation_pk','p',ARRAY['id']),
('Quotation','pc_quotation_u1','u',ARRAY['businessId','id']),
('Quotation','pc_quotation_u2','u',ARRAY['businessId','number']),
('Quotation','pc_quotation_i1','i',ARRAY['businessId','ownerUserId','createdAt']),
('QuotationRevision','pc_quotationrevision_pk','p',ARRAY['id']),
('QuotationRevision','pc_quotationrevision_u1','u',ARRAY['businessId','quotationId','id']),
('QuotationRevision','pc_quotationrevision_u2','u',ARRAY['businessId','id']),
('QuotationRevision','pc_quotationrevision_u3','u',ARRAY['businessId','quotationId','revisionNumber']),
('QuotationRevision','pc_quotationrevision_i1','i',ARRAY['businessId','contactId']),
('QuotationPricingSnapshot','pc_quotationpricingsnapshot_pk','p',ARRAY['id']),
('QuotationPricingSnapshot','pc_quotationpricingsnapshot_u1','u',ARRAY['businessId','revisionId','id']),
('QuotationPricingSnapshot','pc_quotationpricingsnapshot_u2','u',ARRAY['businessId','id']),
('QuotationPricingSnapshot','pc_quotationpricingsnapshot_u3','u',ARRAY['businessId','revisionId','revisionVersion']),
('QuotationRevisionItem','pc_quotationrevisionitem_pk','p',ARRAY['id']),
('QuotationRevisionItem','pc_quotationrevisionitem_u1','u',ARRAY['businessId','snapshotId','position']),
('QuotationApprovalHistory','pc_quotationapprovalhistory_pk','p',ARRAY['id']),
('QuotationApprovalHistory','pc_quotationapprovalhistory_i1','i',ARRAY['businessId','snapshotId','createdAt']),
('QuotationEvent','pc_quotationevent_pk','p',ARRAY['id']),
('QuotationEvent','pc_quotationevent_i1','i',ARRAY['businessId','snapshotId','createdAt']),
('CommercialMutationRequest','pc_commercialmutationrequest_pk','p',ARRAY['id']),
('CommercialMutationRequest','pc_commercialmutationrequest_u1','u',ARRAY['businessId','actorUserId','operation','key']))
SELECT pg_temp.assert_true(count(*)=22 AND bool_and(i.indexrelid IS NOT NULL AND i.indisvalid AND ((e.kind='i' AND NOT i.indisunique) OR (e.kind='u' AND i.indisunique AND NOT i.indisprimary) OR (e.kind='p' AND i.indisprimary)) AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num)=e.cols),'all named PK/unique/index column orders') FROM expected e LEFT JOIN pg_index i ON i.indexrelid=to_regclass(format('public.%I',e.name)) AND i.indrelid=to_regclass(format('public.%I',e.tab));

BEGIN;
INSERT INTO "Quotation"("id","businessId","number","creatorUserId","ownerUserId","updatedAt") VALUES ('qa','A','QT-2030-00001','actor','actor',now()),('qb','B','QT-2030-00001','actor','actor',now()),('qa2','A','QT-2030-00002','actor','actor',now());
INSERT INTO "QuotationRevision"("id","businessId","quotationId","revisionNumber","contactId","timezone","currency","issueDate","validUntil","terms","notes","updatedAt") VALUES
 ('ra','A','qa',1,'customer-A','Asia/Kolkata','INR','2030-01-01','2030-02-01','terms','',now()),
 ('rb','B','qb',1,'customer-B','Asia/Kolkata','INR','2030-01-01','2030-02-01','terms','',now()),
 ('ra2','A','qa2',1,'customer-A','Asia/Kolkata','INR','2030-01-01','2030-02-01','terms','',now());
INSERT INTO "QuotationPricingSnapshot"("id","businessId","revisionId","revisionVersion","pricingVersion","policyVersion","policySnapshot","customerSnapshot","canonicalInput","pricingOutput","contentHash","hashVersion","expectedItemCount") VALUES
 ('sa','A','ra',1,'synthetic','synthetic','{}','{}','{}','{}',repeat('a',64),'mm-commercial-content-v1',1),
 ('sb','B','rb',1,'synthetic','synthetic','{}','{}','{}','{}',repeat('b',64),'mm-commercial-content-v1',1);
INSERT INTO "QuotationRevisionItem"("id","businessId","snapshotId","position","description","quantity","unitPrice","taxRate","discountInput","calculation") VALUES ('ia','A','sa','0','synthetic',1,10,0,'{}','{}'),('ib','B','sb','0','synthetic',1,10,0,'{}','{}');
UPDATE "QuotationPricingSnapshot" SET "sealedAt"=now();
UPDATE "QuotationRevision" SET "currentSnapshotId"='sa' WHERE "id"='ra';
UPDATE "QuotationRevision" SET "currentSnapshotId"='sb' WHERE "id"='rb';
UPDATE "Quotation" SET "currentDraftRevisionId"='ra' WHERE "id"='qa';
INSERT INTO "QuotationApprovalHistory"("id","businessId","snapshotId","actorUserId","event","reason","metadata") VALUES ('approval','A','sa','actor','synthetic','test','{}');
INSERT INTO "QuotationEvent"("id","businessId","snapshotId","actorUserId","event","metadata") VALUES ('event','A','sa','actor','synthetic','{}');
INSERT INTO "CommercialMutationRequest"("id","businessId","actorUserId","operation","key","requestHash","result") VALUES ('request','A','actor','synthetic','key',repeat('a',64),'{}');
COMMIT;
SELECT pg_temp.assert_true((SELECT "version"=1 AND "state"='draft' AND "approvalState"='unassessed' AND "sentAt" IS NULL FROM "QuotationRevision" WHERE "id"='ra'),'revision defaults');
SELECT pg_temp.reject('UPDATE "Quotation" SET "currentDraftRevisionId"=''rb'' WHERE "id"=''qa''','23503','foreign tenant draft pointer','constraint:pc_quotation_f1');
SELECT pg_temp.reject('UPDATE "Quotation" SET "effectiveSentRevisionId"=''rb'' WHERE "id"=''qa''','23503','foreign sent pointer','constraint:pc_quotation_f2');
SELECT pg_temp.reject('UPDATE "Quotation" SET "currentDraftRevisionId"=''ra2'' WHERE "id"=''qa''','23503','wrong quotation pointer','constraint:pc_quotation_f1');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "currentSnapshotId"=''sb'' WHERE "id"=''ra''','23503','foreign snapshot','constraint:pc_quotationrevision_f2');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "currentSnapshotId"=''sa'' WHERE "id"=''ra2''','23503','wrong revision snapshot','constraint:pc_quotationrevision_f2');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "quotationId"=''qb'' WHERE "id"=''ra2''','23503','foreign parent','constraint:pc_quotationrevision_f1');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "state"=''sent'' WHERE "id"=''ra''','23514','sent needs timestamp','checkexpr:QuotationRevision:state <> ''sent''');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "sentAt"=now() WHERE "id"=''ra''','23514','draft timestamp','checkexpr:QuotationRevision:state <> ''draft''');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "state"=''superseded'' WHERE "id"=''ra''','23514','superseded timestamp','checkexpr:QuotationRevision:state <> ''superseded''');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "state"=''sent'',"sentAt"=now() WHERE "id"=''ra2''','P0001','send needs snapshot','COMMERCIAL_SENT_SNAPSHOT_INVALID');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "state"=''sent'',"sentAt"=now(),"version"=2 WHERE "id"=''ra''','P0001','send version','COMMERCIAL_SENT_SNAPSHOT_INVALID');
SELECT pg_temp.reject('INSERT INTO "QuotationRevisionItem" SELECT ''late'',"businessId","snapshotId",''1'',"description","quantity","unitPrice","taxRate","discountInput","calculation" FROM "QuotationRevisionItem" WHERE "id"=''ia''','P0001','sealed draft append','COMMERCIAL_SNAPSHOT_SEALED');
SELECT pg_temp.reject('UPDATE "QuotationPricingSnapshot" SET "sealedAt"=NULL WHERE "id"=''sa''','P0001','unseal','COMMERCIAL_HISTORY_IMMUTABLE');
SELECT pg_temp.reject('UPDATE "QuotationPricingSnapshot" SET "sealedAt"=now() WHERE "id"=''sa''','P0001','reseal','COMMERCIAL_HISTORY_IMMUTABLE');
DO $$ DECLARE t text;
BEGIN FOREACH t IN ARRAY ARRAY['QuotationPricingSnapshot','QuotationRevisionItem','QuotationApprovalHistory','QuotationEvent','CommercialMutationRequest'] LOOP
 PERFORM pg_temp.reject(format('UPDATE %I SET "id"="id"',t),'P0001',t||' update','COMMERCIAL_HISTORY_IMMUTABLE');
 PERFORM pg_temp.reject(format('DELETE FROM %I',t),'P0001',t||' delete','COMMERCIAL_HISTORY_IMMUTABLE');
END LOOP; END $$;
SELECT pg_temp.reject('DELETE FROM "QuotationRevision" WHERE "id"=''ra2''','P0001','revision retained','COMMERCIAL_REVISION_RETAINED');
UPDATE "QuotationRevision" SET "state"='sent',"sentAt"=now() WHERE "id"='ra';
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "terms"=''changed'' WHERE "id"=''ra''','P0001','sent freeze','SENT_REVISION_IMMUTABLE');
UPDATE "QuotationRevision" SET "state"='expired' WHERE "id"='ra';
SELECT pg_temp.assert_true((SELECT "sentAt" IS NOT NULL FROM "QuotationRevision" WHERE "id"='ra'),'expiry retains sentAt');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "sentAt"=NULL WHERE "id"=''ra''','P0001','clear timestamp','SENT_REVISION_IMMUTABLE');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "state"=''draft'' WHERE "id"=''ra''','P0001','return draft','SENT_REVISION_IMMUTABLE');
UPDATE "QuotationRevision" SET "state"='withdrawn' WHERE "id"='ra2';
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "notes"=''changed'' WHERE "id"=''ra2''','P0001','never sent freeze','SENT_REVISION_IMMUTABLE');
\echo PASS: catalog subset, tenant pointers, lifecycle, sealing and initial-send SQL checks

SELECT pg_temp.reject('INSERT INTO "QuotationApprovalHistory"("id","businessId","snapshotId","actorUserId","event","reason","metadata") VALUES (''foreignApproval'',''A'',''sb'',''actor'',''synthetic'',''test'',''{}'')','23503','foreign approval FK','constraint:pc_quotationapprovalhistory_f1');
SELECT pg_temp.reject('INSERT INTO "QuotationEvent"("id","businessId","snapshotId","actorUserId","event","metadata") VALUES (''foreignEvent'',''A'',''sb'',''actor'',''synthetic'',''{}'')','23503','foreign event FK','constraint:pc_quotationevent_f1');
SELECT pg_temp.reject('INSERT INTO "QuotationRevisionItem"("id","businessId","snapshotId","position","description","quantity","unitPrice","taxRate","discountInput","calculation") VALUES (''foreignItem'',''A'',''sb'',''0'',''test'',1,1,0,''{}'',''{}'')','P0001','foreign item parent','COMMERCIAL_CONTENT_INSERT_FORBIDDEN');
SELECT pg_temp.reject('INSERT INTO "QuotationPricingSnapshot"("id","businessId","revisionId","revisionVersion","pricingVersion","policyVersion","policySnapshot","customerSnapshot","canonicalInput","pricingOutput","contentHash","hashVersion","expectedItemCount") VALUES (''foreignSnapshot'',''A'',''rb'',1,''synthetic'',''synthetic'',''{}'',''{}'',''{}'',''{}'',repeat(''a'',64),''mm-commercial-content-v1'',1)','P0001','foreign snapshot parent','COMMERCIAL_CONTENT_INSERT_FORBIDDEN');
SELECT pg_temp.reject('INSERT INTO "QuotationSequence" VALUES (''badYear'',0,0)','23514','invalid sequence year','check:QuotationSequence:year');
SELECT pg_temp.reject('INSERT INTO "QuotationSequence" VALUES (''negative'',2030,-1)','23514','negative sequence','check:QuotationSequence:lastValue');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "currency"=''inr'' WHERE "id"=''rb''','23514','currency format','check:QuotationRevision:currency');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "validUntil"=''2029-01-01'' WHERE "id"=''rb''','23514','expiry order','check:QuotationRevision:validUntil');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "version"=0 WHERE "id"=''rb''','23514','positive version','check:QuotationRevision:version');
SELECT pg_temp.reject('UPDATE "QuotationRevision" SET "approvalState"=''unknown'' WHERE "id"=''rb''','23514','approval state','check:QuotationRevision:approvalState');

-- Exact expected CHECK counts per table, in addition to behavioral negatives.
WITH expected(tab,n) AS (VALUES ('QuotationSequence',2),('Quotation',1),('QuotationRevision',9),('QuotationPricingSnapshot',4),('QuotationRevisionItem',4),('QuotationApprovalHistory',0),('QuotationEvent',0),('CommercialMutationRequest',2))
SELECT pg_temp.assert_true(bool_and((SELECT count(*) FROM pg_constraint c WHERE c.conrelid=to_regclass(format('public.%I',e.tab)) AND c.contype='c')=e.n),'CHECK inventory') FROM expected e;

-- Executable SQL-boundary tests, NOT service-security tests. These deliberately
-- expect direct SQL to permit cases delegated to services by this proposal.
-- Do NOT relabel successful observations as safe production rejection guarantees.
BEGIN;
UPDATE "QuotationRevision" SET "state"='sent',"sentAt"=now(),"terms"='changed-during-send' WHERE "id"='rb';
SELECT pg_temp.assert_true((SELECT "state"='sent' AND "terms"='changed-during-send' FROM "QuotationRevision" WHERE "id"='rb'),'observe initial-send simultaneous content SQL boundary');
ROLLBACK;
SELECT pg_temp.assert_true((SELECT "state"='draft' AND "terms"='terms' FROM "QuotationRevision" WHERE "id"='rb'),'boundary probe rollback');
BEGIN;
UPDATE "QuotationRevision" SET "state"='sent' WHERE "id"='ra';
SELECT pg_temp.assert_true((SELECT "state"='sent' FROM "QuotationRevision" WHERE "id"='ra'),'observe expired-to-sent SQL boundary');
ROLLBACK;
SELECT pg_temp.assert_true((SELECT "state"='expired' FROM "QuotationRevision" WHERE "id"='ra'),'terminal probe rollback');
BEGIN;
UPDATE "QuotationRevision" SET "version"=2 WHERE "id"='rb';
UPDATE "QuotationRevision" SET "version"=1 WHERE "id"='rb';
SELECT pg_temp.assert_true((SELECT "version"=1 FROM "QuotationRevision" WHERE "id"='rb'),'observe positive version-regression SQL boundary');
ROLLBACK;
\echo UNVERIFIED: service rejection of simultaneous send/content change, terminal reactivation and version regression

-- Helper self-test: unrelated P0001 must never satisfy a named trigger expectation.
DO $$
BEGIN
 BEGIN
  PERFORM pg_temp.reject('DO $x$ BEGIN RAISE EXCEPTION ''unrelated synthetic failure''; END $x$;',
                         'P0001','helper specificity','COMMERCIAL_SNAPSHOT_INCOMPLETE');
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'FAIL: helper specificity message class mismatch' THEN
   RAISE EXCEPTION 'FAIL: rejection helper self-test unexpected class';
  END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'FAIL: rejection helper accepted unrelated P0001';
END $$;

DO $$ DECLARE terminal text;
BEGIN
 FOREACH terminal IN ARRAY ARRAY['expired','withdrawn','superseded'] LOOP
  -- Nested exception block rolls back this SQL-boundary probe without preserving
  -- its lifecycle change; actual service reactivation denial remains UNVERIFIED.
  BEGIN
   UPDATE "QuotationRevision" SET "state"=terminal WHERE "id"='ra';
   UPDATE "QuotationRevision" SET "state"='sent' WHERE "id"='ra';
   PERFORM pg_temp.assert_true((SELECT "state"='sent' AND "sentAt" IS NOT NULL FROM "QuotationRevision" WHERE "id"='ra'),'terminal historical SQL boundary');
   RAISE EXCEPTION USING ERRCODE='PZ001', MESSAGE='MM_PHASEC_BOUNDARY_ROLLBACK';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN
   IF SQLERRM <> 'MM_PHASEC_BOUNDARY_ROLLBACK' THEN RAISE EXCEPTION 'FAIL: terminal boundary rollback class'; END IF;
  END;
 END LOOP;
END $$;
SELECT pg_temp.assert_true((SELECT "state"='expired' FROM "QuotationRevision" WHERE "id"='ra'),'terminal matrix rollback');
\echo SQL harness checks complete; real audit integration, lifecycle authorization and hash reconciliation UNVERIFIED
