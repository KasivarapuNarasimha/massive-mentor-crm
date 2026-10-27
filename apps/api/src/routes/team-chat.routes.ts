import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { verifyToken } from "../services/auth.service.js";
import { ChatError, chatId, directInput, groupInput, membersInput, messageInput, pageInput, readInput } from "../services/team-chat-policy.js";
import * as chat from "../services/team-chat.service.js";

const router: Router = Router();
router.use(requireAuth);
export function chatActor(req: AuthenticatedRequest): chat.ChatActor {
  if (!req.user) throw new ChatError(401,"CHAT_AUTH_REQUIRED");
  if (req.supportMode || req.user.platformRole === "super_admin") throw new ChatError(403,"CHAT_ACCESS_DENIED");
  const count=req.rawHeaders.filter((_,i)=>i%2===0 && req.rawHeaders[i].toLowerCase()==="x-business-id").length;
  const businessId=req.headers["x-business-id"];
  if(count!==1 || typeof businessId!=="string" || !chatId.safeParse(businessId).success) throw new ChatError(400,"CHAT_BUSINESS_REQUIRED");
  const token=req.headers.authorization?.slice(7);if(!token)throw new ChatError(401,"CHAT_AUTH_REQUIRED");
  let decoded;
  try { decoded=verifyToken(token); } catch { throw new ChatError(401,"CHAT_SESSION_EXPIRED"); }
  if(decoded.userId!==req.user.id || decoded.portal==="admin" || decoded.supportMode)throw new ChatError(403,"CHAT_ACCESS_DENIED");
  return { userId:req.user.id,businessId,tv:decoded.tv ?? 0,sid:decoded.sid || undefined,portal:decoded.portal || "customer" };
}
function failure(error: unknown,res: Response) {
  if(res.headersSent){res.end();return;}
  if(error instanceof z.ZodError){res.status(400).json({success:false,code:"CHAT_INVALID_INPUT",error:"Check the message or conversation fields."});return;}
  const safe=error instanceof ChatError?error:new ChatError(503,"CHAT_UNAVAILABLE");
  if(safe.status===429)res.setHeader("Retry-After","60");
  res.status(safe.status).json({success:false,code:safe.code,error:safe.status===503?"Team Chat is temporarily unavailable.":safe.code});
}
type Handler = (req: AuthenticatedRequest,res: Response,next: NextFunction)=>Promise<unknown>;
const endpoint=(fn:(req:AuthenticatedRequest)=>Promise<unknown>):Handler=>async(req,res)=>{
  try{res.json({success:true,data:await fn(req)});}catch(error){failure(error,res);}
};
router.get("/members",endpoint(req=>chat.chatMembers(chatActor(req),z.string().trim().max(80).parse(req.query.search || ""))));
router.get("/conversations",endpoint(req=>chat.chatConversations(chatActor(req))));
router.post("/direct",endpoint(req=>chat.chatDirect(chatActor(req),directInput.parse(req.body).userId)));
router.post("/groups",endpoint(req=>chat.chatGroup(chatActor(req),groupInput.parse(req.body))));
router.post("/conversations/:id/members",endpoint(req=>chat.chatAddMembers(chatActor(req),chatId.parse(req.params.id),membersInput.parse(req.body).userIds)));
router.get("/conversations/:id/messages",endpoint(req=>chat.chatHistory(chatActor(req),chatId.parse(req.params.id),pageInput.parse(req.query).before)));
router.post("/conversations/:id/messages",endpoint(req=>chat.chatSend(chatActor(req),chatId.parse(req.params.id),messageInput.parse(req.body))));
router.post("/conversations/:id/read",endpoint(req=>chat.chatRead(chatActor(req),chatId.parse(req.params.id),readInput.parse(req.body).sequence)));

// Durable DB-backed refreshes, not private text on an in-memory/public room.
// Bounded per-process connections and 60-second lease; every heartbeat rechecks
// JWT expiry/tokenVersion/session/business/module membership before any response.
const streams=new Map<string,number>();
router.get("/stream",async(req:AuthenticatedRequest,res:Response)=>{
  let timer:ReturnType<typeof setTimeout>|undefined;let closed=false;let key="";let acquired=false;
  const finish=()=>{if(closed)return;closed=true;if(timer)clearTimeout(timer);if(acquired){const n=(streams.get(key)||1)-1;if(n)streams.set(key,n);else streams.delete(key);}if(!res.writableEnded)res.end();};
  try{
    const a=chatActor(req);key=a.userId;
    if((streams.get(key)||0)>=2 || streams.size>=1000)throw new ChatError(429,"CHAT_STREAM_LIMIT");
    streams.set(key,(streams.get(key)||0)+1);acquired=true;
    let previous="";const deadline=Date.now()+60000;
    await chat.chatConversations(a);
    res.setHeader("Content-Type","text/event-stream; charset=utf-8");res.setHeader("Cache-Control","no-store, no-transform");
    res.setHeader("X-Accel-Buffering","no");res.flushHeaders();
    req.on("close",finish);res.on("close",finish);
    const tick=async()=>{
      if(closed)return;
      try{
        if(Date.now()>=deadline)return finish();
        const data=await chat.chatConversations(chatActor(req));
        if(closed)return;
        const revision=JSON.stringify([data.unreadTotal,data.conversations.map(c=>[c.id,c.lastSequence,c.lastReadSequence,c.updatedAt])]);
        const output=revision===previous?": heartbeat\n\n":"event: chat_refresh\ndata: {\"changed\":true}\n\n";
        previous=revision;
        if(!res.write(output))return finish(); // Do not buffer slow clients indefinitely.
        timer=setTimeout(()=>void tick(),5000);
      }catch{finish();}
    };
    void tick();
  }catch(error){failure(error,res);finish();}
});
export default router;
