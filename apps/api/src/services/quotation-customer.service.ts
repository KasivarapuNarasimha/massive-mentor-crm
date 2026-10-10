import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { authorize,transaction,mutate,audit,reconcileStoredItems,visible,type QuoteActor } from "./quotation.service.js";
import { CommercialDocumentError,object,id,text,canonical,parseCommercialConfiguration,approvalRequired } from "./commercial-document.service.js";
import { deliveryPolicy,encryptDelivery,decryptDelivery,randomLink,tokenHash,newOtp,otpHash,verifyOtpHash,customerLink,sendCommercialEmail } from "./commercial-delivery.service.js";
import { nextFinanceInvoiceNumber } from "./invoice-sequence.service.js";
type Tx=Prisma.TransactionClient;
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
function conflict(code:string):never {throw new CommercialDocumentError(code,409);}
function expected(v:unknown){if(typeof v!=="number"||!Number.isSafeInteger(v)||v<1||v>=2147483647)conflict("EXPECTED_VERSION_REQUIRED");return v as number;}
async function policies(tx:Tx,businessId:string){const b=await tx.business.findUniqueOrThrow({where:{id:businessId},select:{settings:true}});const s=b.settings as {commercial?:unknown;commercialDelivery?:unknown};return {commercial:parseCommercialConfiguration(s?.commercial),delivery:deliveryPolicy(s?.commercialDelivery)};}
async function lockedDraft(tx:Tx,actor:QuoteActor,quotationId:string,expectedVersion:number,revisionVersion:number,snapshotId:string){
 await tx.$queryRaw`SELECT "id" FROM "Quotation" WHERE "businessId"=${actor.businessId} AND "id"=${quotationId} FOR UPDATE`;
 const q=await tx.quotation.findFirst({where:{businessId:actor.businessId,id:quotationId}});if(!q||q.version!==expectedVersion||!q.currentDraftRevisionId)conflict("QUOTATION_VERSION_CONFLICT");
 const context=await authorize(tx,actor,"quotation.send",q.ownerUserId);
 await tx.$queryRaw`SELECT "id" FROM "QuotationRevision" WHERE "businessId"=${actor.businessId} AND "id"=${q.currentDraftRevisionId} FOR UPDATE`;
 const r=await tx.quotationRevision.findFirst({where:{id:q.currentDraftRevisionId!,businessId:actor.businessId,quotationId:q.id}});
 if(!r||r.state!=="draft"||r.sentAt!==null||r.version!==revisionVersion||r.currentSnapshotId!==snapshotId||r.validUntil<=new Date())conflict("QUOTATION_SEND_CONFLICT");
 await visible(tx,context,q,r);
 const s=await tx.quotationPricingSnapshot.findFirst({where:{id:snapshotId,businessId:actor.businessId,revisionId:r.id}});if(!s?.sealedAt||s.revisionVersion!==r.version)conflict("QUOTATION_SNAPSHOT_CONFLICT");
 const verified=await reconcileStoredItems(tx,s),p=await policies(tx,actor.businessId),e=verified.envelope;
 const fields={businessId:actor.businessId,quotationId:q.id,quotationNumber:q.number,revisionId:r.id,revisionNumber:String(r.revisionNumber),revisionVersion:String(r.version),ownerUserId:q.ownerUserId,contactId:r.contactId,dealId:r.dealId,issueDate:r.issueDate.toISOString(),validUntil:r.validUntil.toISOString(),terms:r.terms,notes:r.notes,currency:r.currency,timezone:r.timezone};
 for(const [k,v] of Object.entries(fields))if(canonical(v)!==canonical(e[k]))conflict("COMMERCIAL_REVISION_SNAPSHOT_MISMATCH");
 if(canonical(p.commercial)!==canonical(s.policySnapshot))conflict("COMMERCIAL_POLICY_STALE");
 if(approvalRequired(p.commercial,verified.output)&&r.approvalState!=="approved")conflict("QUOTATION_APPROVAL_REQUIRED");
 if(!approvalRequired(p.commercial,verified.output)&&r.approvalState!=="not_required"&&r.approvalState!=="approved")conflict("QUOTATION_APPROVAL_STATE_INVALID");
 if(new Prisma.Decimal(verified.output.grandTotal).lte(0))conflict("ZERO_TOTAL_INVOICE_POLICY_REQUIRED");
 await authorize(tx,{userId:p.delivery.invoiceIssuerUserId,businessId:actor.businessId},"invoice.issue");
 const customer=e.customerSnapshot as {email?:unknown};if(typeof customer.email!=="string"||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)||/[\r\n]/.test(customer.email))conflict("CUSTOMER_EMAIL_REQUIRED");
 return {q,r,s,p,verified,email:customer.email};
}
export async function sendQuotation(actor:QuoteActor,quotationId:string,key:unknown,input:unknown){
 const row=object(input,["expectedVersion","expectedRevisionVersion","snapshotId"]),ev=expected(row.expectedVersion),rv=expected(row.expectedRevisionVersion),sid=id(row.snapshotId);
 const queued=await mutate(actor,"quotation.send",key,{quotationId,expectedVersion:String(ev),expectedRevisionVersion:String(rv),snapshotId:sid},"quotation.send",async tx=>{
  const {q,r,p,email}=await lockedDraft(tx,actor,quotationId,ev,rv,sid);
  if(await tx.quotationInvoiceConversion.findUnique({where:{businessId_quotationId:{businessId:actor.businessId,quotationId:q.id}}}))conflict("QUOTATION_ALREADY_CONVERTED");
  if(await tx.quotationCustomerAccess.findFirst({where:{businessId:actor.businessId,revisionId:r.id,revokedAt:null}}))conflict("QUOTATION_DELIVERY_ALREADY_QUEUED");
  const token=randomLink(),url=customerLink(token),expiresAt=new Date(Math.min(r.validUntil.getTime(),Date.now()+p.delivery.linkMinutes*60000));
  const access=await tx.quotationCustomerAccess.create({data:{businessId:actor.businessId,snapshotId:sid,quotationId:q.id,revisionId:r.id,senderUserId:actor.userId,tokenHash:tokenHash(token),policy:json(p.delivery),expiresAt}});
  const d=await tx.commercialDelivery.create({data:{businessId:actor.businessId,accessId:access.id,kind:"link",payload:encryptDelivery({to:email,subject:`Quotation ${q.number}`,text:`Review quotation ${q.number} securely: ${url}\nCustomer email verification is required to accept or decline.`})}});
  await audit(tx,actor,q.id,sid,"quotation.delivery.queued",{deliveryId:d.id,revisionId:r.id});
  return {quotationId:q.id,revisionId:r.id,snapshotId:sid,deliveryId:d.id,expectedVersion:ev,revisionVersion:rv};
 }) as {quotationId:string;revisionId:string;snapshotId:string;deliveryId:string;expectedVersion:number;revisionVersion:number};
 await deliverCommercialMessage(queued.deliveryId,actor);
 return {quotationId,deliveryId:queued.deliveryId,state:"sent"};
}
/** Leased durable outbox; SMTP is outside transactions. Finalization is retryable.
 * At-least-once email delivery is possible after a transport/process crash; conversion remains exactly once.
 */
export async function deliverCommercialMessage(deliveryId:string,actor?:QuoteActor){
 const leased=await transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "CommercialDelivery" WHERE "id"=${deliveryId} FOR UPDATE`;
  const d=await tx.commercialDelivery.findUnique({where:{id:deliveryId},include:{access:true}});if(!d)conflict("DELIVERY_NOT_FOUND");
  if(actor){if(d.businessId!==actor.businessId||d.access.senderUserId!==actor.userId)conflict("DELIVERY_SCOPE_DENIED");await authorize(tx,actor,"quotation.send");}
  if(d.state==="delivered")return d;
  if(d.access.revokedAt||d.access.consumedAt||d.access.expiresAt<=new Date())conflict("QUOTATION_LINK_UNAVAILABLE");
  if(d.state==="sending"&&d.leaseUntil&&d.leaseUntil>new Date())conflict("DELIVERY_IN_PROGRESS");
  if(d.attempts>=deliveryPolicy(d.access.policy).maxResends)conflict("DELIVERY_ATTEMPTS_EXHAUSTED");
  await tx.commercialDelivery.update({where:{id:d.id},data:{state:"sending",attempts:{increment:1},leaseUntil:new Date(Date.now()+60000)}});return d;
 });
 if(leased.state!=="delivered"){
  try{if(!leased.payload)conflict("DELIVERY_PAYLOAD_UNAVAILABLE");await sendCommercialEmail(decryptDelivery(leased.payload));}
  catch(e){await transaction(async tx=>{await tx.commercialDelivery.update({where:{id:deliveryId},data:{state:"failed",leaseUntil:null}});});throw e;}
 }
 await transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Quotation" WHERE "businessId"=${leased.businessId} AND "id"=${leased.access.quotationId} FOR UPDATE`;
  const d=await tx.commercialDelivery.findUniqueOrThrow({where:{id:deliveryId},include:{access:true}});
  if(d.access.revokedAt||d.access.expiresAt<=new Date())conflict("QUOTATION_LINK_UNAVAILABLE");
  if(d.kind==="link"){
   if(!actor)conflict("DELIVERY_ACTOR_REQUIRED");
   const q=await tx.quotation.findFirstOrThrow({where:{id:d.access.quotationId,businessId:d.businessId}});
   if(!d.access.deliveredAt){
    const r=await tx.quotationRevision.findUniqueOrThrow({where:{id:d.access.revisionId}});
    await lockedDraft(tx,actor,q.id,q.version,r.version,d.access.snapshotId);
    if(q.effectiveSentRevisionId)await tx.quotationRevision.update({where:{id:q.effectiveSentRevisionId,businessId:q.businessId,state:"sent"},data:{state:"superseded"}});
    await tx.quotationCustomerAccess.updateMany({where:{businessId:d.businessId,quotationId:q.id,id:{not:d.accessId},revokedAt:null},data:{revokedAt:new Date()}});
    await tx.quotationRevision.update({where:{id:r.id,businessId:d.businessId},data:{state:"sent",sentAt:new Date()}});
    await tx.quotation.update({where:{id:q.id,businessId:q.businessId},data:{version:{increment:1},effectiveSentRevisionId:r.id,currentDraftRevisionId:null}});
    await tx.quotationCustomerAccess.update({where:{id:d.accessId},data:{deliveredAt:new Date()}});
    await audit(tx,actor,q.id,d.access.snapshotId,"quotation.sent",{deliveryId:d.id,revisionId:r.id});
   }
  }else{
   const c=await tx.quotationOtpChallenge.findUnique({where:{accessId:d.accessId}});
   if(c&&c.version===d.challengeVersion&&!c.usedAt)await tx.quotationOtpChallenge.update({where:{id:c.id},data:{deliveredAt:new Date()}});
   await customerAudit(tx,d.access,"quotation.otp.delivered",{deliveryId:d.id});
  }
  await tx.commercialDelivery.update({where:{id:deliveryId},data:{state:"delivered",payload:null,leaseUntil:null,deliveredAt:new Date()}});
 });
}
async function customerAudit(tx:Tx,a:{id:string;businessId:string;quotationId:string;snapshotId:string},event:string,metadata:Prisma.InputJsonValue){
 await tx.quotationEvent.create({data:{businessId:a.businessId,snapshotId:a.snapshotId,actorUserId:"customer:"+a.id,event,metadata}});
 await tx.auditLog.create({data:{businessId:a.businessId,actorUserId:null,action:event,entityType:"quotation",entityId:a.quotationId,metadata:{customerAccessId:a.id,evidence:metadata}}});
}
async function customerAccess(tx:Tx,token:unknown,allowConsumed=false){
 const hash=tokenHash(token),found=await tx.quotationCustomerAccess.findUnique({where:{tokenHash:hash}});if(!found)throw new CommercialDocumentError("QUOTATION_LINK_UNAVAILABLE",404);
 // Global order: quotation, revision, access, challenge. Token lookups are SELECT-only.
 await tx.$queryRaw`SELECT "id" FROM "Quotation" WHERE "businessId"=${found.businessId} AND "id"=${found.quotationId} FOR UPDATE`;
 await tx.$queryRaw`SELECT "id" FROM "QuotationRevision" WHERE "businessId"=${found.businessId} AND "id"=${found.revisionId} FOR UPDATE`;
 await tx.$queryRaw`SELECT "id" FROM "QuotationCustomerAccess" WHERE "id"=${found.id} FOR UPDATE`;
 const a=await tx.quotationCustomerAccess.findUniqueOrThrow({where:{id:found.id}});
 const q=await tx.quotation.findFirst({where:{id:a.quotationId,businessId:a.businessId}}),r=await tx.quotationRevision.findFirst({where:{id:a.revisionId,businessId:a.businessId,quotationId:a.quotationId}});
 if(!q||!r||!a.deliveredAt||a.revokedAt||a.expiresAt<=new Date()||r.validUntil<=new Date()||q.effectiveSentRevisionId!==r.id||(!allowConsumed&&a.consumedAt)||(!a.consumedAt&&r.state!=="sent"))throw new CommercialDocumentError("QUOTATION_LINK_UNAVAILABLE",404);
 await authorize(tx,{userId:a.senderUserId,businessId:a.businessId},"quotation.send",q.ownerUserId);
 const s=await tx.quotationPricingSnapshot.findFirstOrThrow({where:{id:a.snapshotId,businessId:a.businessId,revisionId:r.id}}),verified=await reconcileStoredItems(tx,s);
 // Successfully sent immutable revisions retain the policy approved at send time.
 // Membership, business and billing are still revalidated on every customer operation.
 return {a,q,r,s,verified,policy:deliveryPolicy(a.policy)};
}
export async function viewCustomerQuotation(token:unknown){return transaction(async tx=>{
 const {a,q,r,verified}=await customerAccess(tx,token,true);
 return {number:q.number,revisionNumber:r.revisionNumber,state:r.state,validUntil:r.validUntil,terms:r.terms,currency:r.currency,items:verified.envelope.items,pricing:verified.output,decision:a.decision};
});}
export async function requestCustomerOtp(token:unknown,input:unknown){
 const row=object(input,["action"]),action=row.action;if(action!=="accepted"&&action!=="rejected")throw new CommercialDocumentError("INVALID_CUSTOMER_DECISION");
 const deliveryId=await transaction(async tx=>{
  const {a,q,verified,policy}=await customerAccess(tx,token),now=new Date();
  const prior=await tx.quotationOtpChallenge.findUnique({where:{accessId:a.id}});
  if(prior&&(prior.sendCount>=policy.maxResends||now.getTime()-prior.lastSentAt.getTime()<policy.resendSeconds*1000))throw new CommercialDocumentError("OTP_RESEND_LIMIT",429);
  const code=newOtp(),v=(prior?.version??0)+1,codeHash=otpHash(a.id,v,action,code),expiresAt=new Date(Math.min(a.expiresAt.getTime(),now.getTime()+policy.otpMinutes*60000));
  await tx.quotationOtpChallenge.upsert({where:{accessId:a.id},create:{id:randomUUID(),businessId:a.businessId,accessId:a.id,version:v,codeHash,action,expiresAt,lastSentAt:now},update:{version:v,codeHash,action,attempts:0,sendCount:{increment:1},expiresAt,lastSentAt:now,usedAt:null,deliveredAt:null}});
  const customer=verified.envelope.customerSnapshot as {email:string};
  const d=await tx.commercialDelivery.create({data:{businessId:a.businessId,accessId:a.id,kind:"otp",challengeVersion:v,payload:encryptDelivery({to:customer.email,subject:`Verify quotation ${q.number}`,text:`Your code to ${action==="accepted"?"accept":"decline"} quotation ${q.number} is ${code}. It expires at ${expiresAt.toISOString()}.`})}});
  await customerAudit(tx,a,"quotation.otp.requested",{challengeVersion:String(v),action});return d.id;
 });
 await deliverCommercialMessage(deliveryId);return {requested:true};
}
export async function verifyCustomerDecision(token:unknown,input:unknown){
 const row=object(input,["action","code"]),action=row.action,code=row.code;
 if((action!=="accepted"&&action!=="rejected")||typeof code!=="string"||!/^\d{6}$/.test(code))throw new CommercialDocumentError("INVALID_CUSTOMER_VERIFICATION");
 const result=await transaction(async tx=>{
  const {a,q,r,s,verified,policy}=await customerAccess(tx,token,true);
  const c=await tx.quotationOtpChallenge.findUnique({where:{accessId:a.id}}),now=new Date();
  if(!c||c.action!==action||!c.deliveredAt||c.expiresAt<=now||c.attempts>=policy.maxAttempts) return {error:"OTP_UNAVAILABLE"};
  if(!verifyOtpHash(c.codeHash,otpHash(a.id,c.version,action,code))){await tx.quotationOtpChallenge.update({where:{id:c.id},data:{attempts:{increment:1}}});await customerAudit(tx,a,"quotation.otp.denied",{challengeVersion:String(c.version)});return {error:"OTP_INVALID"};}
  if(a.consumedAt){if(a.decision!==action||!c.usedAt)conflict("CUSTOMER_DECISION_CONFLICT");const prior=await tx.quotationInvoiceConversion.findUnique({where:{businessId_quotationId:{businessId:a.businessId,quotationId:q.id}}});return {decision:action,invoiceId:prior?.invoiceId??null,replayed:true};}
  if(c.usedAt)conflict("OTP_REPLAY_CONFLICT");
  let invoiceId:string|null=null;
  if(action==="accepted"){
   await authorize(tx,{userId:policy.invoiceIssuerUserId,businessId:a.businessId},"invoice.issue");
   const prior=await tx.quotationInvoiceConversion.findUnique({where:{businessId_quotationId:{businessId:a.businessId,quotationId:q.id}}});if(prior)conflict("QUOTATION_ALREADY_CONVERTED");
   if(r.dealId){
    await tx.$queryRaw`SELECT "id" FROM "Deal" WHERE "businessId"=${a.businessId} AND "id"=${r.dealId} FOR UPDATE`;
    if(await tx.invoice.findFirst({where:{businessId:a.businessId,sourceType:"deal",sourceId:r.dealId,status:{not:"cancelled"}}})||await tx.salesOrder.findFirst({where:{businessId:a.businessId,dealId:r.dealId,status:{not:"cancelled"}}}))conflict("EXISTING_DEAL_FINANCE_RECONCILIATION_REQUIRED");
   }
   const total=new Prisma.Decimal(verified.output.grandTotal);if(total.lte(0))conflict("ZERO_TOTAL_INVOICE_POLICY_REQUIRED");
   await tx.$executeRaw`SELECT set_config('mm.commercial_write','on',true)`;
   const number=await nextFinanceInvoiceNumber(a.businessId,tx),customer=verified.envelope.customerSnapshot as {name:string};
   const invoice=await tx.invoice.create({data:{businessId:a.businessId,userId:policy.invoiceIssuerUserId,number,contactId:r.contactId,clientName:customer.name,description:`Quotation ${q.number} revision ${r.revisionNumber}`,amount:verified.output.taxableBase,taxRate:"0",taxAmount:verified.output.tax,total:verified.output.grandTotal,currency:r.currency,status:"sent",paidAt:null,issueDate:now,dueDate:new Date(now.getTime()+policy.invoiceDueDays*86400000),sourceType:"quotation",sourceId:q.id,customFields:{commercial:{snapshotId:s.id,revisionId:r.id,dealId:r.dealId,pricing:json(verified.output),taxRepresentation:"per_line_snapshot"}}}});
   const conversion=await tx.quotationInvoiceConversion.create({data:{businessId:a.businessId,quotationId:q.id,snapshotId:s.id,revisionId:r.id,invoiceId:invoice.id,acceptedAt:now,customerSnapshot:s.customerSnapshot as Prisma.InputJsonValue,pricingSnapshot:s.pricingOutput as Prisma.InputJsonValue}});invoiceId=conversion.invoiceId;
   await customerAudit(tx,a,"quotation.invoice.issued",{invoiceId,number,status:"sent",paymentCreated:false});
  }
  await tx.quotationCustomerAccess.update({where:{id:a.id},data:{consumedAt:now,decision:action}});
  await tx.quotationOtpChallenge.update({where:{id:c.id},data:{usedAt:now}});
  await tx.quotationRevision.update({where:{id:r.id,businessId:a.businessId,state:"sent"},data:{state:action}});
  await tx.quotation.update({where:{id:q.id,businessId:a.businessId},data:{version:{increment:1}}});
  await customerAudit(tx,a,"quotation.customer."+action,{challengeVersion:String(c.version),verifiedEmail:true,invoiceId});
  return {decision:action,invoiceId,replayed:false};
 });
 if("error" in result)throw new CommercialDocumentError(result.error!,422);return result;
}

export async function cancelQuotationDelivery(actor:QuoteActor,quotationId:string,key:unknown,input:unknown){
 const row=object(input,["expectedVersion","reason"]),ev=expected(row.expectedVersion),reason=text(row.reason,4000);if(!reason.trim())throw new CommercialDocumentError("CANCELLATION_REASON_REQUIRED");
 return mutate(actor,"quotation.delivery.cancel",key,{quotationId,expectedVersion:String(ev),reason},"quotation.update",async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Quotation" WHERE "businessId"=${actor.businessId} AND "id"=${quotationId} FOR UPDATE`;
  const q=await tx.quotation.findFirst({where:{id:quotationId,businessId:actor.businessId}});if(!q||q.version!==ev||!q.currentDraftRevisionId)conflict("QUOTATION_VERSION_CONFLICT");
  const ctx=await authorize(tx,actor,"quotation.update",q.ownerUserId),r=await tx.quotationRevision.findFirstOrThrow({where:{id:q.currentDraftRevisionId,businessId:q.businessId}});await visible(tx,ctx,q,r);
  const a=await tx.quotationCustomerAccess.findFirst({where:{businessId:q.businessId,revisionId:r.id,revokedAt:null,deliveredAt:null}});if(!a)conflict("NO_PENDING_QUOTATION_DELIVERY");
  await tx.quotationCustomerAccess.update({where:{id:a.id},data:{revokedAt:new Date()}});
  await tx.commercialDelivery.updateMany({where:{businessId:q.businessId,accessId:a.id,state:{not:"delivered"}},data:{state:"failed",payload:null,leaseUntil:null}});
  await tx.quotation.update({where:{id:q.id,version:ev,businessId:q.businessId},data:{version:{increment:1}}});
  await audit(tx,actor,q.id,a.snapshotId,"quotation.delivery.cancelled",{reason});return {quotationId:q.id,snapshotId:a.snapshotId,version:ev+1,state:"cancelled"};
 });
}
