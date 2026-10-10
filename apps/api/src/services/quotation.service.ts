import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { resolveCommercialActionAccess, assertCommercialReferences, buildCommercialReferenceScope, CommercialAccessError } from "./commercial-access.service.js";
import { evaluateCommercialBillingAccess } from "./commercial-billing-access.service.js";
import { calculateCommercialQuote, COMMERCIAL_PRICING_VERSION } from "./commercial-pricing.service.js";
import { CommercialDocumentError, object, text, id, canonical, contentHash, COMMERCIAL_HASH_VERSION,
  parseCommercialConfiguration, commercialYear, normalizeQuoteInput, normalizeQuoteRequest, approvalRequired, reconcileCommercialSnapshot } from "./commercial-document.service.js";
import { moduleForCommercialAction, type CommercialAction } from "./commercial-policy.js";
import type { LeadWriteContext } from "./tenant-scope.service.js";

type Tx=Prisma.TransactionClient;
export type QuoteActor={userId:string;businessId:string};
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const date=(value:unknown)=>{
  const s=text(value,40), d=new Date(s);
  if(!Number.isFinite(d.getTime())||d.toISOString()!==s) throw new CommercialDocumentError("UTC_MILLISECOND_DATE_REQUIRED");
  return d;
};
const version=(value:unknown)=>{
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1||value>=2147483647) throw new CommercialDocumentError("EXPECTED_VERSION_REQUIRED",409);
  return value;
};
export async function authorize(tx:Tx,actor:QuoteActor,action:CommercialAction,ownerUserId?:string) {
  // Lock rows used by authorization. No repair/provisioning or root-client reads.
  await tx.$queryRaw`SELECT "id" FROM "Business" WHERE "id"=${actor.businessId} FOR SHARE`;
  const users=[...new Set([actor.userId,...(ownerUserId?[ownerUserId]:[])])].sort();
  for(const user of users) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${user} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "BusinessMember" WHERE "businessId"=${actor.businessId} AND "userId"=${user} FOR SHARE`;
  }
  const context=await resolveCommercialActionAccess(actor.userId,actor.businessId,moduleForCommercialAction(action),action,tx);
  if(!(await evaluateCommercialBillingAccess(context,tx)).allowed) throw new CommercialDocumentError("COMMERCIAL_BILLING_DENIED",402);
  if(ownerUserId) {
    const owner=await tx.businessMember.findUnique({where:{businessId_userId:{businessId:actor.businessId,userId:ownerUserId}},include:{user:{select:{isDisabled:true}}}});
    if(!owner||owner.user.isDisabled) throw new CommercialAccessError("Enabled exact quotation owner membership required");
    if(context.role==="sales_executive"&&ownerUserId!==actor.userId) throw new CommercialAccessError("Quotation owner scope denied");
    if(context.role==="sales_manager") {
      const scope=await buildCommercialReferenceScope(context,tx);
      const userScope=scope.dealWhere.userId;
      const ids=typeof userScope==="string"?[userScope]:userScope?.in??[];
      if(!ids.includes(ownerUserId)) throw new CommercialAccessError("Quotation team scope denied");
    }
  }
  return context;
}
async function references(tx:Tx,actor:QuoteActor,action:CommercialAction,contactId:string,dealId:string|null) {
  await tx.$queryRaw`SELECT "id" FROM "Contact" WHERE "businessId"=${actor.businessId} AND "id"=${contactId} FOR SHARE`;
  if(dealId) await tx.$queryRaw`SELECT "id" FROM "Deal" WHERE "businessId"=${actor.businessId} AND "id"=${dealId} FOR SHARE`;
  await assertCommercialReferences(actor.userId,actor.businessId,{contactId,dealId},"quotations",tx,action);
  const contact=await tx.contact.findFirstOrThrow({where:{businessId:actor.businessId,id:contactId,deletedAt:null},select:{id:true,name:true,email:true,phone:true,company:true}});
  return {version:"mm-commercial-customer-v1",id:contact.id,name:text(contact.name),email:contact.email===null?null:text(contact.email),
    phone:contact.phone===null?null:text(contact.phone),company:contact.company===null?null:text(contact.company)};
}
async function configuration(tx:Tx,businessId:string) {
  const b=await tx.business.findUniqueOrThrow({where:{id:businessId},select:{settings:true}});
  return parseCommercialConfiguration((b.settings as {commercial?:unknown}|null)?.commercial);
}
export async function visible(tx:Tx,context:Readonly<LeadWriteContext>,quote:{ownerUserId:string},revision:{contactId:string;dealId:string|null}) {
  if(context.role==="sales_executive" && quote.ownerUserId!==context.userId) throw new CommercialAccessError("Quotation scope denied");
  if(context.role==="sales_executive"||context.role==="sales_manager") {
    const scope=await buildCommercialReferenceScope(context,tx);
    const s=scope.dealWhere.userId;
    const ids=typeof s==="string"?[s]:s?.in??[];
    if(!ids.includes(quote.ownerUserId)) throw new CommercialAccessError("Quotation team scope denied");
    await assertCommercialReferences(context.userId,context.businessId,{contactId:revision.contactId,dealId:revision.dealId},"quotations",tx,"quotation.read");
  }
}
export async function audit(tx:Tx,actor:QuoteActor,quoteId:string,snapshotId:string,event:string,metadata:Prisma.InputJsonValue) {
  await tx.quotationEvent.create({data:{businessId:actor.businessId,snapshotId,actorUserId:actor.userId,event,metadata}});
  await tx.auditLog.create({data:{businessId:actor.businessId,actorUserId:actor.userId,action:event,entityType:"quotation",entityId:quoteId,metadata}});
}
export async function transaction<T>(run:(tx:Tx)=>Promise<T>):Promise<T> {
  // No retry of a partially committed operation. Prisma aborts the entire transaction.
  try {return await prisma.$transaction(run,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5000,timeout:15000});}
  catch(e) {
    if(e instanceof Prisma.PrismaClientKnownRequestError && ["P2034","P2002"].includes(e.code)) throw new CommercialDocumentError("COMMERCIAL_TRANSACTION_CONFLICT",409);
    throw e;
  }
}
export async function mutate(actor:QuoteActor,operation:string,key:unknown,input:unknown,action:CommercialAction,
    run:(tx:Tx)=>Promise<unknown>) {
  const requestKey=id(key), requestHash=contentHash(input);
  return transaction(async tx=>{
    await authorize(tx,actor,action);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.businessId}),hashtext(${actor.userId+":"+operation+":"+requestKey}))`;
    const prior=await tx.commercialMutationRequest.findUnique({where:{businessId_actorUserId_operation_key:{businessId:actor.businessId,actorUserId:actor.userId,operation,key:requestKey}}});
    if(prior) {
      if(prior.requestHash!==requestHash) throw new CommercialDocumentError("IDEMPOTENCY_KEY_CONFLICT",409);
      const result=prior.result as {quotationId?:string;snapshotId?:string};
      if(!result.quotationId||!result.snapshotId) throw new CommercialDocumentError("INVALID_REPLAY_RESULT",409);
      const quote=await tx.quotation.findFirst({where:{id:result.quotationId,businessId:actor.businessId}});
      const snapshot=await tx.quotationPricingSnapshot.findFirst({where:{id:result.snapshotId,businessId:actor.businessId},include:{revision:true}});
      if(!quote||!snapshot||snapshot.revision.quotationId!==quote.id||!snapshot.sealedAt) throw new CommercialDocumentError("INVALID_REPLAY_RESULT",409);
      const context=await authorize(tx,actor,action,quote.ownerUserId);
      await visible(tx,context,quote,snapshot.revision);
      reconcileCommercialSnapshot(snapshot);
      return prior.result;
    }
    const result=await run(tx);
    await tx.commercialMutationRequest.create({data:{businessId:actor.businessId,actorUserId:actor.userId,operation,key:requestKey,requestHash,result:json(result)}});
    return result;
  });
}
function draftInput(input:unknown) {
  const row=object(input,["contactId","dealId","ownerUserId","issueDate","validUntil","terms","notes","pricing","expectedVersion","expectedRevisionVersion"]);
  const issueDate=date(row.issueDate),validUntil=date(row.validUntil);
  if(validUntil<issueDate) throw new CommercialDocumentError("INVALID_QUOTATION_VALIDITY");
  return {contactId:id(row.contactId),dealId:row.dealId===null?null:id(row.dealId),ownerUserId:id(row.ownerUserId),
    issueDate,validUntil,terms:text(row.terms),notes:text(row.notes),pricing:normalizeQuoteRequest(row.pricing),
    ...(row.expectedVersion===undefined?{}:{expectedVersion:version(row.expectedVersion)}),
    ...(row.expectedRevisionVersion===undefined?{}:{expectedRevisionVersion:version(row.expectedRevisionVersion)})};
}
async function snapshot(tx:Tx,actor:QuoteActor,quote:{id:string;number:string;ownerUserId:string;version:number},revision:{id:string;revisionNumber:number;version:number},data:ReturnType<typeof draftInput>, action:CommercialAction) {
  const config=await configuration(tx,actor.businessId);
  const customerSnapshot=await references(tx,actor,action,data.contactId,data.dealId);
  const calculation=normalizeQuoteInput(data.pricing,config);
  const envelope={hashVersion:COMMERCIAL_HASH_VERSION,businessId:actor.businessId,quotationId:quote.id,quotationNumber:quote.number,
    revisionId:revision.id,revisionNumber:String(revision.revisionNumber),revisionVersion:String(revision.version),ownerUserId:quote.ownerUserId,
    contactId:data.contactId,dealId:data.dealId,issueDate:data.issueDate.toISOString(),validUntil:data.validUntil.toISOString(),terms:data.terms,notes:data.notes,
    currency:config.currency.code,timezone:config.timezone,customerSnapshot,policyVersion:config.version,policySnapshot:config,
    pricingVersion:COMMERCIAL_PRICING_VERSION,items:calculation.items,pricingOutput:calculation.pricingOutput};
  const canonicalInput={engineInput:calculation.engineInput,contentEnvelope:envelope};
  const row=await tx.quotationPricingSnapshot.create({data:{businessId:actor.businessId,revisionId:revision.id,revisionVersion:revision.version,
    pricingVersion:COMMERCIAL_PRICING_VERSION,policyVersion:config.version,policySnapshot:json(config),customerSnapshot:json(customerSnapshot),
    canonicalInput:json(canonicalInput),pricingOutput:json(calculation.pricingOutput),contentHash:contentHash({...envelope,canonicalInput}),
    hashVersion:COMMERCIAL_HASH_VERSION,expectedItemCount:calculation.items.length}});
  await tx.quotationRevisionItem.createMany({data:calculation.items.map(item=>({businessId:actor.businessId,snapshotId:row.id,position:item.position,
    description:item.description,quantity:item.quantity,unitPrice:item.unitPrice,taxRate:item.taxRate,discountInput:json(item.discountInput),calculation:json(item.calculation)}))});
  // Reconcile server calculation before irreversible sealing. SQL independently counts/version-checks items.
  reconcileCommercialSnapshot(row);
  await tx.quotationPricingSnapshot.update({where:{id:row.id,businessId:actor.businessId},data:{sealedAt:new Date()}});
  const required=approvalRequired(config,calculation.pricingOutput);
  await tx.quotationRevision.update({where:{id:revision.id,businessId:actor.businessId,version:revision.version},data:{currentSnapshotId:row.id,approvalState:required?"required":"not_required"}});
  return {quotationId:quote.id,revisionId:revision.id,snapshotId:row.id,number:quote.number,version:quote.version??1,revisionVersion:revision.version,pricing:calculation.pricingOutput,approvalRequired:required};
}
export async function createQuotation(actor:QuoteActor,key:unknown,input:unknown) {
  const data=draftInput(input);
  if(data.expectedVersion!==undefined||data.expectedRevisionVersion!==undefined) throw new CommercialDocumentError("CREATE_VERSION_NOT_ALLOWED");
  return mutate(actor,"quotation.create",key,json({...data,issueDate:data.issueDate.toISOString(),validUntil:data.validUntil.toISOString()}),"quotation.create",async tx=>{
    await authorize(tx,actor,"quotation.create",data.ownerUserId);
    await references(tx,actor,"quotation.create",data.contactId,data.dealId);
    const config=await configuration(tx,actor.businessId),year=commercialYear(new Date(),config.timezone);
    const seq=await tx.quotationSequence.upsert({where:{businessId_year:{businessId:actor.businessId,year}},create:{businessId:actor.businessId,year,lastValue:1},update:{lastValue:{increment:1}}});
    const quote=await tx.quotation.create({data:{businessId:actor.businessId,creatorUserId:actor.userId,ownerUserId:data.ownerUserId,number:`QT-${year}-${String(seq.lastValue).padStart(5,"0")}`}});
    const revision=await tx.quotationRevision.create({data:{businessId:actor.businessId,quotationId:quote.id,revisionNumber:1,contactId:data.contactId,dealId:data.dealId,
      issueDate:data.issueDate,validUntil:data.validUntil,terms:data.terms,notes:data.notes,currency:config.currency.code,timezone:config.timezone}});
    const result=await snapshot(tx,actor,quote,revision,data,"quotation.create");
    await tx.quotation.update({where:{id:quote.id,businessId:actor.businessId},data:{currentDraftRevisionId:revision.id}});
    await audit(tx,actor,quote.id,result.snapshotId,"quotation.created",{revisionId:revision.id});
    return result;
  });
}
export async function editQuotationDraft(actor:QuoteActor,quotationId:string,key:unknown,input:unknown,newRevision=false) {
  const data=draftInput(input), expected=version(data.expectedVersion);
  if(newRevision&&data.expectedRevisionVersion!==undefined) throw new CommercialDocumentError("UNEXPECTED_REVISION_VERSION",422);
  const expectedRevision=newRevision?undefined:version(data.expectedRevisionVersion);
  return mutate(actor,newRevision?"quotation.revision.create":"quotation.update",key,
    json({quotationId,newRevision,...data,expectedVersion:String(expected),...(expectedRevision===undefined?{}:{expectedRevisionVersion:String(expectedRevision)}),issueDate:data.issueDate.toISOString(),validUntil:data.validUntil.toISOString()}),"quotation.update",async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "Quotation" WHERE "businessId"=${actor.businessId} AND "id"=${quotationId} FOR UPDATE`;
    const quote=await tx.quotation.findFirst({where:{id:quotationId,businessId:actor.businessId}});
    if(!quote||quote.version!==expected) throw new CommercialDocumentError("QUOTATION_VERSION_CONFLICT",409);
    const context=await authorize(tx,actor,"quotation.update",quote.ownerUserId);
    if(data.ownerUserId!==quote.ownerUserId) throw new CommercialDocumentError("QUOTATION_OWNER_CHANGE_NOT_SUPPORTED",409);
    const currentId=quote.currentDraftRevisionId??quote.effectiveSentRevisionId;
    const current=currentId?await tx.quotationRevision.findFirst({where:{id:currentId,businessId:actor.businessId,quotationId:quote.id}}):null;
    if(!current) throw new CommercialDocumentError("QUOTATION_REVISION_REQUIRED",409);
    await visible(tx,context,quote,current);
    await tx.$queryRaw`SELECT "id" FROM "QuotationRevision" WHERE "businessId"=${actor.businessId} AND "id"=${current.id} FOR UPDATE`;
    if(await tx.quotationCustomerAccess.findFirst({where:{businessId:actor.businessId,revisionId:current.id,revokedAt:null,deliveredAt:null}})) throw new CommercialDocumentError("CANCEL_PENDING_DELIVERY_BEFORE_EDIT",409);
    if(await tx.quotationInvoiceConversion.findUnique({where:{businessId_quotationId:{businessId:actor.businessId,quotationId:quote.id}}})) throw new CommercialDocumentError("CONVERTED_QUOTATION_IMMUTABLE",409);
    const config=await configuration(tx,actor.businessId);
    let revision;
    if(newRevision) {
      if(quote.currentDraftRevisionId) throw new CommercialDocumentError("CURRENT_DRAFT_ALREADY_EXISTS",409);
      const count=await tx.quotationRevision.aggregate({where:{businessId:actor.businessId,quotationId:quote.id},_max:{revisionNumber:true}});
      revision=await tx.quotationRevision.create({data:{businessId:actor.businessId,quotationId:quote.id,revisionNumber:(count._max.revisionNumber??0)+1,
        contactId:data.contactId,dealId:data.dealId,issueDate:data.issueDate,validUntil:data.validUntil,terms:data.terms,notes:data.notes,currency:config.currency.code,timezone:config.timezone}});
    } else {
      if(current.state!=="draft"||current.sentAt!==null||current.version!==expectedRevision||quote.currentDraftRevisionId!==current.id) throw new CommercialDocumentError("DRAFT_VERSION_CONFLICT",409);
      if(current.currentSnapshotId) await tx.quotationApprovalHistory.create({data:{businessId:actor.businessId,snapshotId:current.currentSnapshotId,actorUserId:actor.userId,event:"stale",reason:"Commercial draft changed",metadata:{nextRevisionVersion:String(current.version+1)}}});
      revision=await tx.quotationRevision.update({where:{id:current.id,businessId:actor.businessId,version:expectedRevision},data:{version:{increment:1},approvalState:"stale",
        contactId:data.contactId,dealId:data.dealId,issueDate:data.issueDate,validUntil:data.validUntil,terms:data.terms,notes:data.notes,currency:config.currency.code,timezone:config.timezone}});
    }
    const changed=await tx.quotation.updateMany({where:{id:quote.id,businessId:actor.businessId,version:expected},data:{version:{increment:1},currentDraftRevisionId:revision.id}});
    if(changed.count!==1) throw new CommercialDocumentError("QUOTATION_VERSION_CONFLICT",409);
    const result=await snapshot(tx,actor,{...quote,version:expected+1},revision,data,"quotation.update");
    await audit(tx,actor,quote.id,result.snapshotId,newRevision?"quotation.revision.created":"quotation.draft.updated",{revisionId:revision.id});
    return result;
  });
}
export async function getQuotation(actor:QuoteActor,quotationId:string) {
  return transaction(async tx=>{
    const context=await authorize(tx,actor,"quotation.read");
    const quote=await tx.quotation.findFirst({where:{id:quotationId,businessId:actor.businessId},include:{revisions:{orderBy:{revisionNumber:"asc"},include:{snapshots:{include:{items:true,approvals:true,events:true}}}}}});
    if(!quote||!quote.revisions.length) throw new CommercialDocumentError("QUOTATION_NOT_FOUND",404);
    const active=quote.revisions.find(r=>r.id===(quote.currentDraftRevisionId??quote.effectiveSentRevisionId));
    if(!active) throw new CommercialDocumentError("QUOTATION_POINTER_INVALID",409);
    await visible(tx,context,quote,active);
    for(const r of quote.revisions) for(const s of r.snapshots) {if(!s.sealedAt) throw new CommercialDocumentError("INCOMPLETE_QUOTATION_SNAPSHOT",409);reconcileCommercialSnapshot(s);}
    return json(quote);
  });
}
export async function listQuotations(actor:QuoteActor) {
  return transaction(async tx=>{
    const context=await authorize(tx,actor,"quotation.read");
    const scope=await buildCommercialReferenceScope(context,tx);
    const ownership=context.role==="sales_executive"?{ownerUserId:actor.userId}:context.role==="sales_manager"?{ownerUserId:scope.dealWhere.userId}:{};
    const rows=await tx.quotation.findMany({where:{businessId:actor.businessId,...ownership},take:50,orderBy:[{createdAt:"desc"},{id:"desc"}],include:{revisions:{select:{id:true,contactId:true,dealId:true}}}});
    const result=[];
    for(const quote of rows) {
      const active=quote.revisions.find(r=>r.id===(quote.currentDraftRevisionId??quote.effectiveSentRevisionId));
      if(!active) continue;
      try {await visible(tx,context,quote,active);result.push({id:quote.id,number:quote.number,version:quote.version,currentDraftRevisionId:quote.currentDraftRevisionId,effectiveSentRevisionId:quote.effectiveSentRevisionId});}
      catch(e) {if(!(e instanceof CommercialAccessError)) throw e;}
    }
    return result;
  });
}

export async function reconcileStoredItems(tx:Tx,snap:Parameters<typeof reconcileCommercialSnapshot>[0]&{id:string;businessId:string}) {
  const verified=reconcileCommercialSnapshot(snap);
  const items=await tx.quotationRevisionItem.findMany({where:{businessId:snap.businessId,snapshotId:snap.id}});
  const ordered=items.sort((a,b)=>BigInt(a.position)<BigInt(b.position)?-1:BigInt(a.position)>BigInt(b.position)?1:0);
  const actual=ordered.map(item=>({position:item.position,description:item.description,quantity:item.quantity.toFixed(4),unitPrice:item.unitPrice.toFixed(2),taxRate:item.taxRate.toFixed(4),discountInput:item.discountInput,calculation:item.calculation}));
  if(canonical(actual)!==canonical(verified.envelope.items)) throw new CommercialDocumentError("COMMERCIAL_ITEM_SNAPSHOT_MISMATCH",409);
  return verified;
}

/** Approval decisions bind to one sealed snapshot, never a quotation container alone. */
export async function requestQuotationApproval(actor:QuoteActor,quotationId:string,key:unknown,input:unknown,decision?:"approved"|"rejected") {
  if(decision!==undefined&&decision!=="approved"&&decision!=="rejected") throw new CommercialDocumentError("INVALID_APPROVAL_DECISION");
  const row=object(input,["expectedVersion","expectedRevisionVersion","snapshotId","reason"]);
  const expected=version(row.expectedVersion),expectedRevision=version(row.expectedRevisionVersion),snapshotId=id(row.snapshotId);
  const reason=text(row.reason,4000);if(!reason.trim()) throw new CommercialDocumentError("APPROVAL_REASON_REQUIRED");
  const action:CommercialAction=decision?"quotation.approve":"quotation.update";
  return mutate(actor,decision?"quotation.approval."+decision:"quotation.approval.submit",key,
    {quotationId,expectedVersion:String(expected),expectedRevisionVersion:String(expectedRevision),snapshotId,reason},action,async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "Quotation" WHERE "businessId"=${actor.businessId} AND "id"=${quotationId} FOR UPDATE`;
    const quote=await tx.quotation.findFirst({where:{id:quotationId,businessId:actor.businessId}});
    if(!quote||quote.version!==expected||!quote.currentDraftRevisionId) throw new CommercialDocumentError("QUOTATION_VERSION_CONFLICT",409);
    const context=await authorize(tx,actor,action,quote.ownerUserId);
    const revision=await tx.quotationRevision.findFirst({where:{businessId:actor.businessId,id:quote.currentDraftRevisionId,quotationId:quote.id}});
    if(!revision||revision.state!=="draft"||revision.sentAt!==null||revision.version!==expectedRevision||revision.currentSnapshotId!==snapshotId) throw new CommercialDocumentError("APPROVAL_REVISION_CONFLICT",409);
    await visible(tx,context,quote,revision);
    if(decision&&(quote.creatorUserId===actor.userId||quote.ownerUserId===actor.userId)) throw new CommercialDocumentError("SELF_APPROVAL_FORBIDDEN",403);
    await tx.$queryRaw`SELECT "id" FROM "QuotationRevision" WHERE "businessId"=${actor.businessId} AND "id"=${revision.id} FOR UPDATE`;
    const snap=await tx.quotationPricingSnapshot.findFirst({where:{id:snapshotId,businessId:actor.businessId,revisionId:revision.id}});
    if(!snap||!snap.sealedAt||snap.revisionVersion!==revision.version) throw new CommercialDocumentError("APPROVAL_SNAPSHOT_CONFLICT",409);
    const verified=await reconcileStoredItems(tx,snap),current=await configuration(tx,actor.businessId);
    const e=verified.envelope;
    const currentContent={businessId:actor.businessId,quotationId:quote.id,quotationNumber:quote.number,revisionId:revision.id,
      revisionNumber:String(revision.revisionNumber),revisionVersion:String(revision.version),ownerUserId:quote.ownerUserId,
      contactId:revision.contactId,dealId:revision.dealId,issueDate:revision.issueDate.toISOString(),validUntil:revision.validUntil.toISOString(),
      terms:revision.terms,notes:revision.notes,currency:revision.currency,timezone:revision.timezone};
    for(const [field,value] of Object.entries(currentContent)) if(canonical(value)!==canonical(e[field])) throw new CommercialDocumentError("COMMERCIAL_REVISION_SNAPSHOT_MISMATCH",409);
    const stale=canonical(current)!==canonical(snap.policySnapshot);
    // Staleness is itself an audited committed outcome, not a swallowed exception.
    if(decision&&revision.approvalState!=="pending") throw new CommercialDocumentError("APPROVAL_NOT_PENDING",409);
    if(!decision&&!stale&&!approvalRequired(current,verified.output)) throw new CommercialDocumentError("APPROVAL_NOT_REQUIRED",409);
    const state=stale?"stale":decision??"pending";
    const changed=await tx.quotationRevision.updateMany({where:{id:revision.id,businessId:actor.businessId,version:expectedRevision,currentSnapshotId:snapshotId,approvalState:revision.approvalState},data:{approvalState:state}});
    if(changed.count!==1) throw new CommercialDocumentError("APPROVAL_REVISION_CONFLICT",409);
    const updated=await tx.quotation.updateMany({where:{id:quote.id,businessId:actor.businessId,version:expected},data:{version:{increment:1}}});
    if(updated.count!==1) throw new CommercialDocumentError("QUOTATION_VERSION_CONFLICT",409);
    await tx.quotationApprovalHistory.create({data:{businessId:actor.businessId,snapshotId,actorUserId:actor.userId,event:state,reason,metadata:{policyVersion:current.version,policyHash:contentHash(current),contentHash:snap.contentHash}}});
    await audit(tx,actor,quote.id,snapshotId,"quotation.approval."+state,{reason,revisionId:revision.id});
    return {quotationId:quote.id,revisionId:revision.id,snapshotId,version:expected+1,revisionVersion:revision.version,approvalState:state};
  });
}
