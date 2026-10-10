import {Prisma} from "@prisma/client";
import {transaction,authorize,authorizeInvoiceIssuer,type QuoteActor} from "./quotation.service.js";
import {object,id,text,contentHash,CommercialDocumentError,parseCommercialConfiguration} from "./commercial-document.service.js";
import {deliveryPolicy} from "./commercial-delivery.service.js";
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export async function getCommercialConfiguration(actor:QuoteActor){return transaction(async tx=>{
 await authorize(tx,actor,"commercial.policy.manage");const b=await tx.business.findUniqueOrThrow({where:{id:actor.businessId},select:{settings:true}});const s=b.settings as Prisma.JsonObject|null;return {commercial:s?.commercial??null,commercialDelivery:s?.commercialDelivery??null};
});}
export async function setCommercialConfiguration(actor:QuoteActor,key:unknown,input:unknown){
 const row=object(input,["expectedPolicyVersion","commercial","commercialDelivery","reason"]),requestKey=id(key),reason=text(row.reason,1000);if(!reason.trim())throw new CommercialDocumentError("POLICY_REASON_REQUIRED");
 const expected=row.expectedPolicyVersion===null?null:id(row.expectedPolicyVersion),policy=parseCommercialConfiguration(row.commercial),delivery=deliveryPolicy(row.commercialDelivery);
 const normalized={expected,policy,delivery:Object.fromEntries(Object.entries(delivery).map(([k,v])=>[k,typeof v==="number"?String(v):v])),reason},requestHash=contentHash(normalized);
 return transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Business" WHERE "id"=${actor.businessId} FOR UPDATE`;
  await authorize(tx,actor,"commercial.policy.manage");
  const prior=await tx.commercialMutationRequest.findUnique({where:{businessId_actorUserId_operation_key:{businessId:actor.businessId,actorUserId:actor.userId,operation:"commercial.policy.update",key:requestKey}}});
  if(prior){if(prior.requestHash!==requestHash)throw new CommercialDocumentError("IDEMPOTENCY_KEY_CONFLICT",409);return prior.result;}
  const b=await tx.business.findUniqueOrThrow({where:{id:actor.businessId},select:{settings:true,updatedAt:true}}),settings=(b.settings??{}) as Prisma.JsonObject;
  const current=settings.commercial as {version?:unknown}|undefined;
  if((current?.version??null)!==expected||policy.version===expected)throw new CommercialDocumentError("COMMERCIAL_POLICY_VERSION_CONFLICT",409);
  await authorizeInvoiceIssuer(tx,actor,delivery.invoiceIssuerUserId,"commercial.policy.manage");
  const changed=await tx.business.updateMany({where:{id:actor.businessId,updatedAt:b.updatedAt},data:{settings:{...settings,commercial:json(row.commercial),commercialDelivery:json(row.commercialDelivery)}}});if(changed.count!==1)throw new CommercialDocumentError("COMMERCIAL_POLICY_VERSION_CONFLICT",409);
  const pending=await tx.quotationRevision.findMany({where:{businessId:actor.businessId,state:"draft",currentSnapshotId:{not:null}},orderBy:{id:"asc"}});
  for(const r of pending){await tx.quotationRevision.update({where:{id:r.id,businessId:actor.businessId},data:{approvalState:"stale"}});await tx.quotationApprovalHistory.create({data:{businessId:actor.businessId,snapshotId:r.currentSnapshotId!,actorUserId:actor.userId,event:"stale",reason:"Commercial policy changed",metadata:{policyVersion:policy.version}}});await tx.quotation.update({where:{id:r.quotationId,businessId:actor.businessId},data:{version:{increment:1}}});}
  await tx.auditLog.create({data:{businessId:actor.businessId,actorUserId:actor.userId,action:"commercial.policy.updated",entityType:"business",entityId:actor.businessId,metadata:{before:{commercial:settings.commercial??null,commercialDelivery:settings.commercialDelivery??null},after:{commercial:json(row.commercial),commercialDelivery:json(row.commercialDelivery)},reason}}});
  const result={businessId:actor.businessId,policyVersion:policy.version,staleDrafts:String(pending.length)};
  await tx.commercialMutationRequest.create({data:{businessId:actor.businessId,actorUserId:actor.userId,operation:"commercial.policy.update",key:requestKey,requestHash,result}});return result;
 });
}
