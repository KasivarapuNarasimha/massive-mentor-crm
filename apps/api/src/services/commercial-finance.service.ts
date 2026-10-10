import { Prisma } from "@prisma/client";
import { authorize,transaction,mutate,audit,type QuoteActor } from "./quotation.service.js";
import { CommercialDocumentError,object,id,text } from "./commercial-document.service.js";
import { parseCommercialDecimal } from "../lib/commercial-money.js";
type Tx=Prisma.TransactionClient;
export function financialBalance(total:string,entries:{id:string;amount:string;reversalOfId:string|null;paidAt:Date}[],dueDate:Date|null,now=new Date()){
 const money=(v:string)=>parseCommercialDecimal(v,"money"),value=money(total);let paid=new Prisma.Decimal(0);
 const originals=new Map(entries.filter(e=>!e.reversalOfId).map(e=>[e.id,e]));const reversed=new Set<string>();
 for(const e of entries){const amount=money(e.amount);if(amount.lte(0))throw new CommercialDocumentError("COMMERCIAL_LEDGER_INVALID",409);
  if(e.reversalOfId){const original=originals.get(e.reversalOfId);if(!original||original.amount!==e.amount||reversed.has(e.reversalOfId))throw new CommercialDocumentError("COMMERCIAL_LEDGER_INVALID",409);reversed.add(e.reversalOfId);paid=paid.sub(amount);}else paid=paid.add(amount);
 }
 if(paid.lt(0)||paid.gt(value))throw new CommercialDocumentError("COMMERCIAL_LEDGER_INVALID",409);
 const balance=value.sub(paid),settled=!balance.isZero()?false:paid.gt(0);
 const status=settled?"paid":dueDate&&dueDate<now?"overdue":"sent";
 const active=entries.filter(e=>!e.reversalOfId&&!reversed.has(e.id));
 const paidAt=settled?active.reduce<Date|null>((last,e)=>!last||e.paidAt>last?e.paidAt:last,null):null;
 return {total:value.toFixed(2),paidAmount:paid.toFixed(2),outstandingBalance:balance.toFixed(2),status,paidAt};
}
async function invoiceScope(tx:Tx,actor:QuoteActor,invoiceId:string){
 await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id"=${invoiceId} AND "businessId"=${actor.businessId} FOR UPDATE`;
 const conversion=await tx.quotationInvoiceConversion.findUnique({where:{businessId_invoiceId:{businessId:actor.businessId,invoiceId}}});
 const invoice=await tx.invoice.findFirst({where:{id:invoiceId,businessId:actor.businessId,sourceType:"quotation"}});
 if(!conversion||!invoice||invoice.sourceId!==conversion.quotationId)throw new CommercialDocumentError("COMMERCIAL_INVOICE_NOT_FOUND",404);
 if(invoice.status==="cancelled")throw new CommercialDocumentError("COMMERCIAL_INVOICE_CANCELLED",409);
 return {invoice,conversion};
}
async function balance(tx:Tx,actor:QuoteActor,invoice:{id:string;total:Prisma.Decimal;dueDate:Date|null}){
 const entries=await tx.commercialPaymentEntry.findMany({where:{businessId:actor.businessId,invoiceId:invoice.id},orderBy:[{createdAt:"asc"},{id:"asc"}]});
 const result=financialBalance(invoice.total.toFixed(2),entries.map(e=>({...e,amount:e.amount.toFixed(2)})),invoice.dueDate);
 const actual=await tx.payment.aggregate({where:{businessId:actor.businessId,invoiceId:invoice.id},_sum:{amount:true}});
 if(!(actual._sum.amount??new Prisma.Decimal(0)).eq(result.paidAmount))throw new CommercialDocumentError("COMMERCIAL_PAYMENT_MIRROR_MISMATCH",409);
 return {result,entries};
}
export async function getCommercialInvoice(actor:QuoteActor,invoiceId:string){return transaction(async tx=>{
 await authorize(tx,actor,"invoice.read");await authorize(tx,actor,"payment.read");const {invoice,conversion}=await invoiceScope(tx,actor,invoiceId),b=await balance(tx,actor,invoice);
 return {id:invoice.id,number:invoice.number,quotationId:conversion.quotationId,revisionId:conversion.revisionId,currency:invoice.currency,amount:invoice.amount.toFixed(2),taxAmount:invoice.taxAmount.toFixed(2),...b.result,customer:conversion.customerSnapshot,pricing:conversion.pricingSnapshot,history:b.entries.map(e=>({...e,amount:e.amount.toFixed(2)}))};
});}
export async function recordCommercialPayment(actor:QuoteActor,invoiceId:string,key:unknown,input:unknown){
 const row=object(input,["amount","method","reference","notes","paidAt"]),amount=parseCommercialDecimal(row.amount,"money").toFixed(2),method=id(row.method);
 if(!["bank","cash","upi","card","other"].includes(method)||new Prisma.Decimal(amount).lte(0))throw new CommercialDocumentError("INVALID_COMMERCIAL_PAYMENT");
 const reference=row.reference===null?null:text(row.reference,512),notes=text(row.notes,4000),paidAt=new Date(text(row.paidAt,40));
 if(!Number.isFinite(paidAt.getTime())||paidAt.toISOString()!==row.paidAt||paidAt>new Date())throw new CommercialDocumentError("INVALID_PAYMENT_DATE");
 return mutate(actor,"payment.record",key,{invoiceId,amount,method,reference,notes,paidAt:paidAt.toISOString()},"payment.record",async tx=>{
  const {invoice,conversion}=await invoiceScope(tx,actor,invoiceId),before=await balance(tx,actor,invoice);
  if(new Prisma.Decimal(amount).gt(before.result.outstandingBalance))throw new CommercialDocumentError("PAYMENT_EXCEEDS_OUTSTANDING",409);
  await tx.$executeRaw`SELECT set_config('mm.commercial_write','on',true)`;
  const p=await tx.payment.create({data:{businessId:actor.businessId,userId:actor.userId,invoiceId,amount,method,reference,notes,paidAt}});
  await tx.commercialPaymentEntry.create({data:{businessId:actor.businessId,invoiceId,paymentId:p.id,actorUserId:actor.userId,amount,method,reference,notes,paidAt}});
  const after=await balance(tx,actor,invoice);
  await tx.invoice.update({where:{id:invoiceId,businessId:actor.businessId},data:{status:after.result.status,paidAt:after.result.paidAt}});
  await audit(tx,actor,conversion.quotationId,conversion.snapshotId,"commercial.payment.recorded",{invoiceId,paymentId:p.id,amount,before:before.result.outstandingBalance,after:after.result.outstandingBalance});
  return {quotationId:conversion.quotationId,snapshotId:conversion.snapshotId,invoiceId,paymentId:p.id,...after.result};
 });
}
export async function reverseCommercialPayment(actor:QuoteActor,invoiceId:string,paymentId:string,key:unknown,input:unknown){
 const row=object(input,["reason"]),reason=text(row.reason,4000);if(!reason.trim())throw new CommercialDocumentError("REVERSAL_REASON_REQUIRED");
 return mutate(actor,"payment.reverse",key,{invoiceId,paymentId,reason},"payment.reverse",async tx=>{
  const {invoice,conversion}=await invoiceScope(tx,actor,invoiceId),before=await balance(tx,actor,invoice);
  const entry=await tx.commercialPaymentEntry.findFirst({where:{businessId:actor.businessId,invoiceId,paymentId,reversalOfId:null}});
  if(!entry||await tx.commercialPaymentEntry.findUnique({where:{reversalOfId:entry.id}}))throw new CommercialDocumentError("PAYMENT_REVERSAL_CONFLICT",409);
  await tx.$executeRaw`SELECT set_config('mm.commercial_write','on',true)`;
  const deleted=await tx.payment.deleteMany({where:{id:paymentId,businessId:actor.businessId,invoiceId}});if(deleted.count!==1)throw new CommercialDocumentError("PAYMENT_REVERSAL_CONFLICT",409);
  await tx.commercialPaymentEntry.create({data:{businessId:actor.businessId,invoiceId,actorUserId:actor.userId,amount:entry.amount,method:entry.method,reference:entry.reference,notes:reason,paidAt:new Date(),reversalOfId:entry.id}});
  const after=await balance(tx,actor,invoice);await tx.invoice.update({where:{id:invoiceId,businessId:actor.businessId},data:{status:after.result.status,paidAt:after.result.paidAt}});
  await audit(tx,actor,conversion.quotationId,conversion.snapshotId,"commercial.payment.reversed",{invoiceId,paymentId,reason,before:before.result.outstandingBalance,after:after.result.outstandingBalance});
  return {quotationId:conversion.quotationId,snapshotId:conversion.snapshotId,invoiceId,paymentId,...after.result};
 });
}
export async function commercialReport(actor:QuoteActor,cursor?:string){return transaction(async tx=>{
 await authorize(tx,actor,"invoice.read");await authorize(tx,actor,"payment.read");
 const rows=await tx.quotationInvoiceConversion.findMany({where:{businessId:actor.businessId},orderBy:{id:"asc"},take:51,...(cursor?{cursor:{id:cursor},skip:1}: {})});
 const page=rows.slice(0,50),items=[];
 for(const row of page){const {invoice}=await invoiceScope(tx,actor,row.invoiceId),b=await balance(tx,actor,invoice);items.push({invoiceId:invoice.id,number:invoice.number,quotationId:row.quotationId,currency:invoice.currency,dueDate:invoice.dueDate,...b.result});}
 return {items,nextCursor:rows.length>50?page[page.length-1].id:null};
});}
