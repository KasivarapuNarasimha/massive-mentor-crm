-- Additive internal messaging only. Review and apply through approved migration
-- process; never db push. Existing AI/WhatsApp/CRM/Finance tables are unchanged.
BEGIN;
CREATE TABLE "TeamChatConversation" (
 "id" TEXT PRIMARY KEY,"businessId" TEXT NOT NULL,"kind" TEXT NOT NULL,
 "directKey" TEXT,"name" TEXT,"description" TEXT,"creatorId" TEXT,
 "lastSequence" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "tc_business" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "tc_creator" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 CONSTRAINT "tc_kind" CHECK (("kind"='direct' AND "directKey" IS NOT NULL AND length("directKey")<=257 AND "name" IS NULL) OR ("kind"='group' AND "directKey" IS NULL AND "name" IS NOT NULL AND length(trim("name")) BETWEEN 1 AND 100)),
 CONSTRAINT "tc_sequence" CHECK ("lastSequence">=0),
 CONSTRAINT "tc_description" CHECK (length("description")<=500)
);
CREATE UNIQUE INDEX "TeamChatConversation_businessId_id_key" ON "TeamChatConversation"("businessId","id");
CREATE UNIQUE INDEX "TeamChatConversation_businessId_directKey_key" ON "TeamChatConversation"("businessId","directKey");
CREATE INDEX "TeamChatConversation_businessId_updatedAt_id_idx" ON "TeamChatConversation"("businessId","updatedAt","id");
CREATE TABLE "TeamChatParticipant" (
 "businessId" TEXT NOT NULL,"conversationId" TEXT NOT NULL,"userId" TEXT NOT NULL,
 "lastReadSequence" INTEGER NOT NULL DEFAULT 0,"joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("businessId","conversationId","userId"),
 CONSTRAINT "tcp_conversation" FOREIGN KEY ("businessId","conversationId") REFERENCES "TeamChatConversation"("businessId","id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "tcp_user" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "tcp_read" CHECK ("lastReadSequence">=0)
);
CREATE INDEX "TeamChatParticipant_businessId_userId_conversationId_idx" ON "TeamChatParticipant"("businessId","userId","conversationId");
CREATE TABLE "TeamChatMessage" (
 "id" TEXT PRIMARY KEY,"businessId" TEXT NOT NULL,"conversationId" TEXT NOT NULL,"senderId" TEXT,
 "senderName" TEXT NOT NULL,"clientMessageId" TEXT NOT NULL,"sequence" INTEGER NOT NULL,
 "content" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "tcm_conversation" FOREIGN KEY ("businessId","conversationId") REFERENCES "TeamChatConversation"("businessId","id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "tcm_sender" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 CONSTRAINT "tcm_content" CHECK (length(trim("content")) BETWEEN 1 AND 4000),
 CONSTRAINT "tcm_sequence" CHECK ("sequence">0),
 CONSTRAINT "tcm_client" CHECK (length("clientMessageId") BETWEEN 8 AND 128)
);
CREATE UNIQUE INDEX "TeamChatMessage_businessId_conversationId_sequence_key" ON "TeamChatMessage"("businessId","conversationId","sequence");
CREATE UNIQUE INDEX "TeamChatMessage_businessId_senderId_clientMessageId_key" ON "TeamChatMessage"("businessId","senderId","clientMessageId");
CREATE INDEX "TeamChatMessage_businessId_conversationId_sequence_idx" ON "TeamChatMessage"("businessId","conversationId","sequence");
CREATE INDEX "TeamChatMessage_businessId_senderId_createdAt_idx" ON "TeamChatMessage"("businessId","senderId","createdAt");
-- Defense in depth on insert, not a replacement for server authorization. Existing
-- users may be removed/disabled without deleting historical conversation messages.
CREATE FUNCTION team_chat_member_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target TEXT; k TEXT; pair TEXT;
BEGIN
 target := to_jsonb(NEW)->>(CASE WHEN TG_TABLE_NAME='TeamChatMessage' THEN 'senderId' ELSE 'userId' END);
 IF target IS NULL OR NOT EXISTS (
   SELECT 1 FROM "BusinessMember" b JOIN "User" u ON u.id=b."userId" JOIN "Business" t ON t.id=b."businessId"
   WHERE b."businessId"=NEW."businessId" AND b."userId"=target AND NOT u."isDisabled" AND t.status='active'
 ) THEN RAISE EXCEPTION 'TEAM_CHAT_MEMBERSHIP_REQUIRED'; END IF;
 IF TG_TABLE_NAME='TeamChatMessage' AND NOT EXISTS (
   SELECT 1 FROM "TeamChatParticipant" p WHERE p."businessId"=NEW."businessId" AND p."conversationId"=NEW."conversationId" AND p."userId"=target
 ) THEN RAISE EXCEPTION 'TEAM_CHAT_PARTICIPANT_REQUIRED'; END IF;
 IF TG_TABLE_NAME='TeamChatParticipant' THEN
   SELECT kind,"directKey" INTO k,pair FROM "TeamChatConversation" WHERE "businessId"=NEW."businessId" AND id=NEW."conversationId" FOR UPDATE;
   IF k='direct' AND (NOT target=ANY(string_to_array(pair,':')) OR
       (SELECT count(*) FROM "TeamChatParticipant" WHERE "businessId"=NEW."businessId" AND "conversationId"=NEW."conversationId")>=2)
   THEN RAISE EXCEPTION 'TEAM_CHAT_DIRECT_PAIR_REQUIRED'; END IF;
   IF (SELECT count(*) FROM "TeamChatParticipant" WHERE "businessId"=NEW."businessId" AND "conversationId"=NEW."conversationId")>=50
   THEN RAISE EXCEPTION 'TEAM_CHAT_GROUP_LIMIT'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER team_chat_participant_guard BEFORE INSERT ON "TeamChatParticipant" FOR EACH ROW EXECUTE FUNCTION team_chat_member_guard();
CREATE TRIGGER team_chat_sender_guard BEFORE INSERT ON "TeamChatMessage" FOR EACH ROW EXECUTE FUNCTION team_chat_member_guard();
CREATE FUNCTION team_chat_complete_creation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k TEXT; pair TEXT; actual TEXT; n INTEGER;
BEGIN
 SELECT kind,"directKey" INTO k,pair FROM "TeamChatConversation" WHERE id=NEW.id AND "businessId"=NEW."businessId";
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT count(*),string_agg("userId",':' ORDER BY "userId" COLLATE "C") INTO n,actual
 FROM "TeamChatParticipant" WHERE "businessId"=NEW."businessId" AND "conversationId"=NEW.id;
 IF (k='direct' AND (n<>2 OR actual<>pair)) OR (k='group' AND (n<2 OR n>50)) THEN
   RAISE EXCEPTION 'TEAM_CHAT_CREATION_INCOMPLETE';
 END IF;
 RETURN NULL;
END $$;
-- Insert-only: later user deletion must not destroy retained message history.
CREATE CONSTRAINT TRIGGER team_chat_creation_complete AFTER INSERT ON "TeamChatConversation"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION team_chat_complete_creation();
-- Register only the module, never users, memberships or explicit grants.
INSERT INTO "CrmModule" (id,key,label,"routePrefix","apiPrefixes",category,"sortOrder","isActive","alwaysOn","updatedAt")
VALUES ('module_team_chat','team_chat','Team Chat','/dashboard/team-chat','["/api/team-chat"]'::jsonb,'crm',29,true,false,CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
COMMIT;
