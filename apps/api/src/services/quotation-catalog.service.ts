import type { Prisma } from "@prisma/client";
import { authorize, transaction, visible } from "./quotation.service.js";
import type { QuoteActor } from "./quotation.service.js";
import { buildCommercialReferenceScope, CommercialAccessError } from "./commercial-access.service.js";
import { CommercialDocumentError, object, text, id, reconcileCommercialSnapshot } from "./commercial-document.service.js";

export const QUOTATION_FILTERS = ["draft","pending_approval","sent","accepted","rejected","expired","converted"] as const;
export function quotationListQuery(input:unknown) {
 const row=object(input,["search","status","cursor"]);
 const search=row.search===undefined?"":text(row.search,120).trim();
 const status=row.status===undefined||row.status===""?null:text(row.status,30);
 if(status&&!QUOTATION_FILTERS.includes(status as typeof QUOTATION_FILTERS[number]))throw new CommercialDocumentError("INVALID_QUOTATION_STATUS",400);
 return {search,status,cursor:row.cursor===undefined?null:id(row.cursor)};
}
export function quotationDisplayStatus(revision:{state:string;approvalState:string;validUntil:Date},converted:boolean,now=new Date()) {
 if(converted)return "converted";
 if(["accepted","rejected","superseded","cancelled","expired"].includes(revision.state))return revision.state;
 if(revision.validUntil<=now)return "expired";
 if(revision.state==="draft"&&revision.approvalState==="pending")return "pending_approval";
 return revision.state;
}
/** Explicit tenant/action gates; no legacy repair-capable CRM reads. */
export async function searchQuotationReferences(actor:QuoteActor,input:unknown) {
 const row=object(input,["kind","search","contactId"]),kind=row.kind;
 if(kind!=="contact"&&kind!=="deal")throw new CommercialDocumentError("INVALID_REFERENCE_KIND",400);
 const search=row.search===undefined?"":text(row.search,120).trim();
 const contactId=row.contactId===undefined?null:id(row.contactId);
 return transaction(async tx=>{
  const ctx=await authorize(tx,actor,"quotation.create"),scope=await buildCommercialReferenceScope(ctx,tx);
  if(kind==="contact")return tx.contact.findMany({where:{businessId:actor.businessId,deletedAt:null,AND:[scope.contactWhere,...(search?[{OR:[{name:{contains:search,mode:"insensitive" as const}},{email:{contains:search,mode:"insensitive" as const}}]}]:[])]},select:{id:true,name:true,email:true,phone:true,company:true},take:25,orderBy:[{updatedAt:"desc"},{id:"desc"}]});
  if(!contactId)return [];
  const contact=await tx.contact.findFirst({where:{businessId:actor.businessId,id:contactId,deletedAt:null,...scope.contactWhere},select:{id:true}});
  if(!contact)throw new CommercialDocumentError("CUSTOMER_UNAVAILABLE",404);
  return tx.deal.findMany({where:{businessId:actor.businessId,contactId,...scope.dealWhere,...(search?{title:{contains:search,mode:"insensitive" as const}}:{})},select:{id:true,title:true,contactId:true},take:25,orderBy:[{updatedAt:"desc"},{id:"desc"}]});
 });
}
export async function searchQuotations(actor:QuoteActor,input:unknown) {
 const query=quotationListQuery(input);
 return transaction(async tx=>{
  const context=await authorize(tx,actor,"quotation.read"),scope=await buildCommercialReferenceScope(context,tx);
  const ownership=context.role==="sales_executive"?{ownerUserId:actor.userId}:context.role==="sales_manager"?{ownerUserId:scope.dealWhere.userId}:{};
  const active:Prisma.QuotationRevisionWhereInput={};
  if(query.status==="expired")Object.assign(active,{state:{in:["draft","sent","expired"]},validUntil:{lte:new Date()}});
  else if(query.status==="pending_approval")Object.assign(active,{state:"draft",approvalState:"pending",validUntil:{gt:new Date()}});
  else if(query.status)Object.assign(active,{state:query.status==="converted"?"accepted":query.status,...(["draft","sent"].includes(query.status)?{validUntil:{gt:new Date()}}:{}),...(query.status==="draft"?{approvalState:{not:"pending"}}:{})});
  if(query.search){
   const contacts=await tx.contact.findMany({where:{businessId:actor.businessId,deletedAt:null,AND:[scope.contactWhere,{OR:[{name:{contains:query.search,mode:"insensitive" as const}},{email:{contains:query.search,mode:"insensitive" as const}}]}]},select:{id:true}});
   const deals=await tx.deal.findMany({where:{businessId:actor.businessId,...scope.dealWhere,title:{contains:query.search,mode:"insensitive" as const}},select:{id:true}});
   active.OR=[{quotation:{number:{contains:query.search,mode:"insensitive" as const}}},{contactId:{in:contacts.map(c=>c.id)}},{dealId:{in:deals.map(d=>d.id)}}];
  }
  let boundary:Prisma.QuotationWhereInput={};
  if(query.cursor){const cursor=await tx.quotation.findFirst({where:{id:query.cursor,businessId:actor.businessId,...ownership},select:{id:true,createdAt:true}});if(!cursor)throw new CommercialDocumentError("INVALID_QUOTATION_CURSOR",400);boundary={OR:[{createdAt:{lt:cursor.createdAt}},{createdAt:cursor.createdAt,id:{lt:cursor.id}}]};}
  const rows=await tx.quotation.findMany({where:{businessId:actor.businessId,...ownership,AND:[boundary,{OR:[{currentDraft:{is:active}},{currentDraftRevisionId:null,effectiveSent:{is:active}}]}]},take:50,orderBy:[{createdAt:"desc"},{id:"desc"}],include:{revisions:{include:{snapshots:true}}}});
  const items=[];
  for(const q of rows){
   const r=q.revisions.find(r=>r.id===(q.currentDraftRevisionId??q.effectiveSentRevisionId));if(!r)continue;
   try{await visible(tx,context,q,r);}catch(error){if(error instanceof CommercialAccessError)continue;throw error;}
   const s=r.snapshots.find(s=>s.id===r.currentSnapshotId);if(!s?.sealedAt)throw new CommercialDocumentError("INCOMPLETE_QUOTATION_SNAPSHOT",409);
   const verified=reconcileCommercialSnapshot(s),conversion=await tx.quotationInvoiceConversion.findUnique({where:{businessId_quotationId:{businessId:actor.businessId,quotationId:q.id}}});
   if(query.status==="converted"&&!conversion)continue;
   const deal=r.dealId?await tx.deal.findFirst({where:{id:r.dealId,businessId:actor.businessId,...scope.dealWhere},select:{title:true}}):null;
   const customer=s.customerSnapshot as {name?:string;email?:string};
   items.push({id:q.id,number:q.number,createdAt:q.createdAt,version:q.version,revisionNumber:r.revisionNumber,state:r.state,status:quotationDisplayStatus(r,!!conversion),approvalState:r.approvalState,customer:customer.name??"",customerEmail:customer.email??"",deal:deal?.title??"",total:verified.output.grandTotal,currency:r.currency,validUntil:r.validUntil,invoiceId:conversion?.invoiceId??null});
  }
  return {items,nextCursor:rows.length===50?rows[rows.length-1].id:null};
 });
}
