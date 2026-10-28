import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getMemberModuleKeys } from "./permissions.service.js";
import { ChatError, canManageChat, chatModuleAllowed, chatReplay, directPair } from "./team-chat-policy.js";

export type ChatActor = { userId: string; businessId: string; tv: number; sid?: string; portal: "customer" | "demo" };
type Tx = Prisma.TransactionClient;
type Member = { userId: string; name: string | null; role: string; permissions: Prisma.JsonValue; tokenVersion: number };
export type ChatMessageRow = { id: string; conversationId: string; senderId: string | null; senderName: string; content: string; sequence: number; createdAt: Date; clientMessageId: string };
type Room = { id: string; kind: string; name: string | null; description: string | null; lastSequence: number; updatedAt: Date };

/** Locks the actual business/user/member rows; no repair, seed or guessed scope. */
async function authorize(tx: Tx, actor: ChatActor): Promise<Member> {
  const rows = await tx.$queryRaw<Member[]>(Prisma.sql`
    SELECT u.id AS "userId",u.name,m.role,m.permissions,u."tokenVersion"
    FROM "BusinessMember" m JOIN "User" u ON u.id=m."userId" JOIN "Business" b ON b.id=m."businessId"
    WHERE m."businessId"=${actor.businessId} AND m."userId"=${actor.userId} AND NOT u."isDisabled"
      AND b.status='active' AND NOT b."isLocked" AND b."portalKind"=${actor.portal}
      AND b."isDemo"=${actor.portal === "demo"}
      AND (b."isDemo" OR (b."planStatus" NOT IN ('expired','locked','suspended','cancelled')
        AND (NOT b."isTrial" OR b."trialEndsAt">CURRENT_TIMESTAMP)
        AND (b."subscriptionEndsAt" IS NULL OR b."isTrial" OR
          b."subscriptionEndsAt"+make_interval(days=>b."gracePeriodDays")>CURRENT_TIMESTAMP)))
    FOR SHARE OF m,u,b`);
  const member = rows[0];
  if (!member || member.tokenVersion !== actor.tv) throw new ChatError(403, "CHAT_ACCESS_DENIED");
  member.role=member.role.trim().toLowerCase();
  if (actor.sid) {
    const session = await tx.userSession.findFirst({ where: {
      id: actor.sid, userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() }, portal: actor.portal,
    }, select: { id: true } });
    if (!session) throw new ChatError(401, "CHAT_SESSION_REVOKED");
  }
  const keys = await getMemberModuleKeys(actor.userId, actor.businessId, {
    userId: actor.userId, businessId: actor.businessId, role: member.role, permissions: member.permissions,
  });
  if (!chatModuleAllowed(keys,member.permissions)) throw new ChatError(403, "CHAT_ACCESS_DENIED");
  return member;
}

async function transaction<T>(actor: ChatActor, action: (tx: Tx, member: Member) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const member = await authorize(tx, actor);
        return action(tx, member);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000, maxWait: 5000 });
    } catch (error) {
      const retryable=error instanceof Prisma.PrismaClientKnownRequestError && (error.code==="P2034" ||
        error.code==="P2010" && ["40001","40P01"].includes(String(error.meta?.code)));
      if (attempt < 2 && (retryable || error instanceof ChatError && error.code==="CHAT_RETRY_DIRECT")) continue;
      throw error;
    }
  }
}

async function room(tx: Tx, a: ChatActor, id: string): Promise<Room> {
  const rows = await tx.$queryRaw<Room[]>(Prisma.sql`
    SELECT c.id,c.kind,c.name,c.description,c."lastSequence",c."updatedAt"
    FROM "TeamChatConversation" c JOIN "TeamChatParticipant" p
      ON p."businessId"=c."businessId" AND p."conversationId"=c.id
    WHERE c."businessId"=${a.businessId} AND c.id=${id} AND p."userId"=${a.userId}
    FOR UPDATE OF c`);
  if (!rows[0]) throw new ChatError(404, "CHAT_NOT_FOUND");
  return rows[0];
}

async function eligible(tx: Tx, actor: ChatActor, ids: string[]): Promise<void> {
  const users = await tx.$queryRaw<Array<{ userId: string; role: string; permissions: Prisma.JsonValue }>>(Prisma.sql`
    SELECT m."userId",m.role,m.permissions FROM "BusinessMember" m JOIN "User" u ON u.id=m."userId"
    WHERE m."businessId"=${actor.businessId} AND m."userId" IN (${Prisma.join(ids)}) AND NOT u."isDisabled" AND u."platformRole"<>'super_admin' FOR SHARE OF m,u`);
  if (users.length !== ids.length) throw new ChatError(400, "CHAT_INELIGIBLE_MEMBER");
  for (const m of users) {
    const keys = await getMemberModuleKeys(m.userId, actor.businessId, { ...m, businessId: actor.businessId });
    if (!chatModuleAllowed(keys,m.permissions)) throw new ChatError(400, "CHAT_INELIGIBLE_MEMBER");
  }
}
async function groupAuthority(tx: Tx,a: ChatActor,role: string,ids: string[]=[]): Promise<boolean> {
  if(!canManageChat(role))return false;
  if(["owner","ceo","admin","business_admin"].includes(role))return true;
  // Team has no tenant key. It may narrow scope, never establish membership:
  // every proposed participant must ALSO pass eligible() in this business.
  const teams=await tx.team.findMany({where:{OR:[{ownerId:a.userId},{members:{some:{userId:a.userId,role:{in:["admin","manager"]}}}}]},
    select:{id:true,members:{select:{userId:true}}}});
  const allowed=new Set([a.userId,...teams.flatMap(t=>t.members.map(m=>m.userId))]);
  return teams.length>0&&ids.every(id=>allowed.has(id));
}
async function audit(tx: Tx, a: ChatActor, id: string, action: string, metadata: Prisma.InputJsonValue = {}) {
  await tx.auditLog.create({ data: { businessId: a.businessId, actorUserId: a.userId,
    action: "team_chat." + action, entityType: "team_chat", entityId: id, metadata } });
}
async function rate(tx: Tx, a: ChatActor, kind: "message" | "conversation") {
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${"team-chat:"+a.businessId+":"+a.userId},0))::text`);
  const rows = kind === "message" ? await tx.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(*)::int n FROM "TeamChatMessage" WHERE "businessId"=${a.businessId} AND "senderId"=${a.userId} AND "createdAt">CURRENT_TIMESTAMP-interval '1 minute'`) :
    await tx.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(*)::int n FROM "TeamChatConversation" WHERE "businessId"=${a.businessId} AND "creatorId"=${a.userId} AND "createdAt">CURRENT_TIMESTAMP-interval '1 minute'`);
  if (rows[0].n >= (kind === "message" ? 30 : 10)) throw new ChatError(429, "CHAT_RATE_LIMIT");
}

export function chatMembers(a: ChatActor, search: string) {
  return transaction(a, async tx => {
    const members = await tx.businessMember.findMany({ where: { businessId: a.businessId, user: {
      isDisabled: false, platformRole: { not: "super_admin" }, ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] } : {}),
    } }, select: { userId: true, role: true, permissions: true, user: { select: { name: true, email: true } } }, orderBy: { userId: "asc" }, take: 50 });
    const allowed = [];
    for (const m of members) {
      if (m.userId === a.userId) continue;
      const keys = await getMemberModuleKeys(m.userId,a.businessId,{ userId:m.userId,businessId:a.businessId,role:m.role,permissions:m.permissions });
      if (chatModuleAllowed(keys,m.permissions)) allowed.push({ id: m.userId, name: m.user.name || m.user.email });
    }
    return allowed;
  });
}

export function chatConversations(a: ChatActor) {
  return transaction(a, async (tx, member) => {
    const conversations = await tx.$queryRaw<Array<Room & { unread: number; lastReadSequence: number; preview: string | null; peer: string | null }>>(Prisma.sql`
      SELECT c.id,c.kind,c.name,c.description,c."lastSequence",c."updatedAt",p."lastReadSequence",
        (SELECT count(*)::int FROM "TeamChatMessage" m WHERE m."businessId"=c."businessId" AND m."conversationId"=c.id AND m.sequence>p."lastReadSequence" AND m."senderId" IS DISTINCT FROM ${a.userId}) unread,
        (SELECT left(m.content,160) FROM "TeamChatMessage" m WHERE m."businessId"=c."businessId" AND m."conversationId"=c.id ORDER BY m.sequence DESC LIMIT 1) preview,
        (SELECT coalesce(u.name,u.email) FROM "TeamChatParticipant" x JOIN "User" u ON u.id=x."userId" WHERE x."businessId"=c."businessId" AND x."conversationId"=c.id AND x."userId"<>${a.userId} ORDER BY x."userId" LIMIT 1) peer
      FROM "TeamChatConversation" c JOIN "TeamChatParticipant" p ON p."businessId"=c."businessId" AND p."conversationId"=c.id
      WHERE c."businessId"=${a.businessId} AND p."userId"=${a.userId} ORDER BY c."updatedAt" DESC,c.id DESC LIMIT 100`);
    const counts = await tx.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(*)::int n FROM "TeamChatMessage" m JOIN "TeamChatParticipant" p ON p."businessId"=m."businessId" AND p."conversationId"=m."conversationId"
      WHERE m."businessId"=${a.businessId} AND p."userId"=${a.userId} AND m.sequence>p."lastReadSequence" AND m."senderId" IS DISTINCT FROM ${a.userId}`);
    return { conversations, unreadTotal: counts[0].n, canManage: await groupAuthority(tx,a,member.role),canSend:member.role!=="viewer" };
  });
}

export function chatDirect(a: ChatActor, targetId: string) {
  const pair = directPair(a.userId, targetId);
  return transaction(a, async (tx,m) => {
    if(m.role==="viewer")throw new ChatError(403,"CHAT_READ_ONLY");
    await eligible(tx,a,[targetId]);
    const previous = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "TeamChatConversation" WHERE "businessId"=${a.businessId} AND "directKey"=${pair}`);
    if (previous[0]) { await room(tx,a,previous[0].id); return previous[0]; }
    await rate(tx,a,"conversation");
    const id = randomUUID();
    const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "TeamChatConversation" (id,"businessId",kind,"directKey","creatorId") VALUES (${id},${a.businessId},'direct',${pair},${a.userId})
      ON CONFLICT ("businessId","directKey") DO NOTHING RETURNING id`);
    if (!inserted.length) throw new ChatError(409,"CHAT_RETRY_DIRECT");
    for (const userId of [a.userId,targetId]) await tx.$executeRaw(Prisma.sql`INSERT INTO "TeamChatParticipant" ("businessId","conversationId","userId") VALUES (${a.businessId},${id},${userId})`);
    await audit(tx,a,id,"direct_created"); return { id };
  });
}

export function chatGroup(a: ChatActor, input: { name: string; description?: string; userIds: string[] }) {
  return transaction(a, async (tx,m) => {
    const ids = [...new Set([a.userId,...input.userIds])];
    if (!await groupAuthority(tx,a,m.role,ids)) throw new ChatError(403,"CHAT_GROUP_FORBIDDEN");
    if (ids.length < 2 || ids.length > 50) throw new ChatError(400,"CHAT_GROUP_LIMIT");
    await eligible(tx,a,ids); await rate(tx,a,"conversation");
    const id = randomUUID();
    await tx.$executeRaw(Prisma.sql`INSERT INTO "TeamChatConversation" (id,"businessId",kind,name,description,"creatorId") VALUES (${id},${a.businessId},'group',${input.name},${input.description || null},${a.userId})`);
    for (const userId of ids) await tx.$executeRaw(Prisma.sql`INSERT INTO "TeamChatParticipant" ("businessId","conversationId","userId") VALUES (${a.businessId},${id},${userId})`);
    await audit(tx,a,id,"group_created",{ participantCount: ids.length }); return { id };
  });
}

export function chatAddMembers(a: ChatActor,id: string,userIds: string[]) {
  return transaction(a, async (tx,m) => {
    const c = await room(tx,a,id);
    const ids = [...new Set(userIds)];
    if (c.kind !== "group" || !await groupAuthority(tx,a,m.role,ids)) throw new ChatError(403,"CHAT_GROUP_FORBIDDEN");
    await eligible(tx,a,ids);
    const current = await tx.$queryRaw<Array<{ userId: string }>>(Prisma.sql`SELECT "userId" FROM "TeamChatParticipant" WHERE "businessId"=${a.businessId} AND "conversationId"=${id}`);
    const added=ids.filter(x=>!current.some(y=>y.userId===x));
    if (current.length+added.length>50) throw new ChatError(400,"CHAT_GROUP_LIMIT");
    for (const userId of added) await tx.$executeRaw(Prisma.sql`INSERT INTO "TeamChatParticipant" ("businessId","conversationId","userId","lastReadSequence") VALUES (${a.businessId},${id},${userId},${c.lastSequence})`);
    if (added.length) { await tx.$executeRaw(Prisma.sql`UPDATE "TeamChatConversation" SET "updatedAt"=CURRENT_TIMESTAMP WHERE "businessId"=${a.businessId} AND id=${id}`); await audit(tx,a,id,"members_added",{ count:added.length }); }
    return { added:added.length };
  });
}

export function chatHistory(a: ChatActor,id: string,before?: number) {
  return transaction(a, async tx => {
    const conversation = await room(tx,a,id);
    const messages = await tx.$queryRaw<ChatMessageRow[]>(Prisma.sql`
      SELECT id,"conversationId","senderId","senderName",content,sequence,"createdAt","clientMessageId" FROM "TeamChatMessage"
      WHERE "businessId"=${a.businessId} AND "conversationId"=${id} AND sequence<${before || 2147483647} ORDER BY sequence DESC LIMIT 51`);
    const more=messages.length>50;const rows=messages.slice(0,50).reverse();
    const participants=await tx.$queryRaw<Array<{ id: string; name: string; active: boolean }>>(Prisma.sql`
      SELECT u.id,coalesce(u.name,u.email) name, (NOT u."isDisabled" AND EXISTS(SELECT 1 FROM "BusinessMember" bm WHERE bm."businessId"=${a.businessId} AND bm."userId"=u.id)) active
      FROM "TeamChatParticipant" p JOIN "User" u ON u.id=p."userId" WHERE p."businessId"=${a.businessId} AND p."conversationId"=${id} ORDER BY u.id`);
    return { conversation, messages: rows, participants, nextBefore: more ? rows[0].sequence : null };
  });
}

export function chatSend(a: ChatActor,id: string,input: { content: string; clientMessageId: string }) {
  return transaction(a, async (tx,m) => {
    if(m.role==="viewer")throw new ChatError(403,"CHAT_READ_ONLY");
    const conversation=await room(tx,a,id);
    if(conversation.kind==="direct"){
      const peers=await tx.$queryRaw<Array<{userId:string}>>(Prisma.sql`SELECT "userId" FROM "TeamChatParticipant" WHERE "businessId"=${a.businessId} AND "conversationId"=${id} AND "userId"<>${a.userId}`);
      if(peers.length!==1)throw new ChatError(409,"CHAT_PEER_UNAVAILABLE");
      await eligible(tx,a,[peers[0].userId]);
    }
    const existing=await tx.$queryRaw<ChatMessageRow[]>(Prisma.sql`SELECT * FROM "TeamChatMessage" WHERE "businessId"=${a.businessId} AND "senderId"=${a.userId} AND "clientMessageId"=${input.clientMessageId}`);
    const replay=chatReplay(existing[0],id,input.content);if(replay)return replay;
    await rate(tx,a,"message");
    const sequence=await tx.$queryRaw<Array<{ n:number }>>(Prisma.sql`UPDATE "TeamChatConversation" SET "lastSequence"="lastSequence"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "businessId"=${a.businessId} AND id=${id} AND "lastSequence"<2147483646 RETURNING "lastSequence" n`);
    if (!sequence[0]) throw new ChatError(409,"CHAT_SEQUENCE_EXHAUSTED");
    const messageId=randomUUID();
    const rows=await tx.$queryRaw<ChatMessageRow[]>(Prisma.sql`
      INSERT INTO "TeamChatMessage" (id,"businessId","conversationId","senderId","senderName","clientMessageId",sequence,content)
      VALUES (${messageId},${a.businessId},${id},${a.userId},${m.name || "Team member"},${input.clientMessageId},${sequence[0].n},${input.content})
      RETURNING id,"conversationId","senderId","senderName","clientMessageId",sequence,content,"createdAt"`);
    const candidates=await tx.$queryRaw<Array<{ userId:string;role:string;permissions:Prisma.JsonValue }>>(Prisma.sql`
      SELECT p."userId",bm.role,bm.permissions FROM "TeamChatParticipant" p JOIN "BusinessMember" bm ON bm."businessId"=p."businessId" AND bm."userId"=p."userId" JOIN "User" u ON u.id=p."userId"
      WHERE p."businessId"=${a.businessId} AND p."conversationId"=${id} AND p."userId"<>${a.userId} AND NOT u."isDisabled" AND u."platformRole"<>'super_admin'`);
    const recipients=[];
    for(const r of candidates){const keys=await getMemberModuleKeys(r.userId,a.businessId,{...r,businessId:a.businessId});if(chatModuleAllowed(keys,r.permissions))recipients.push(r);}
    // Existing inbox, generic copy only. No chat text or push/email side effect.
    await tx.notification.createMany({ data: recipients.map(r=>({ userId:r.userId,type:"team_chat",title:"New team message",message:"Open Team Chat to view your conversation.",entityType:"team_chat",entityId:id })) });
    await audit(tx,a,id,"message_sent",{ messageId, sequence:sequence[0].n });return rows[0];
  });
}

export function chatRead(a: ChatActor,id: string,sequence: number) {
  return transaction(a, async tx => {
    const c=await room(tx,a,id);if(sequence>c.lastSequence)throw new ChatError(400,"CHAT_INVALID_READ_CURSOR");
    await tx.$executeRaw(Prisma.sql`UPDATE "TeamChatParticipant" SET "lastReadSequence"=greatest("lastReadSequence",${sequence}) WHERE "businessId"=${a.businessId} AND "conversationId"=${id} AND "userId"=${a.userId}`);
    if(sequence===c.lastSequence)await tx.notification.updateMany({ where:{ userId:a.userId,type:"team_chat",entityType:"team_chat",entityId:id,isRead:false },data:{isRead:true} });
    return { sequence };
  });
}
