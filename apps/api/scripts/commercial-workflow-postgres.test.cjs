// CI-only application integration tests. No discovery, application startup, seeds or real SMTP.
const assert=require("node:assert/strict"),{test,before,after}=require("node:test"),{randomUUID}=require("node:crypto");
const {loadWith,req}=require("./commercial-test-loader.cjs");
const {PrismaClient}=req("@prisma/client"),jwt=req("jsonwebtoken"),express=req("express");
const run=process.env.GITHUB_RUN_ID,attempt=process.env.GITHUB_RUN_ATTEMPT,expectedDb=`mm_phasecapp_${run}_${attempt}`;
if(process.env.GITHUB_ACTIONS!=="true"||process.env.RUNNER_ENVIRONMENT!=="github-hosted"||process.env.MM_PHASEC_DISPOSABLE!=="YES"||!/^\d+$/.test(run||"")||!/^\d+$/.test(attempt||""))throw Error("Disposable GitHub-hosted execution required");
const url=new URL(process.env.MM_PHASEC_APPLICATION_URL||"");
if(url.hostname!=="127.0.0.1"||url.username!=="mm_phasec"||url.password!=="phasec_dummy_only"||url.pathname!=="/"+expectedDb||url.port!==process.env.MM_PHASEC_PG_PORT||url.search)throw Error("Explicit disposable target rejected");
const db=new PrismaClient({datasources:{db:{url:url.toString()}},log:[]});const emails=[];
process.env.COMMERCIAL_DELIVERY_KEY=Buffer.alloc(32,11).toString("base64");process.env.COMMERCIAL_PUBLIC_URL="https://synthetic.example.invalid";
const never=()=>{throw Error("LEGACY_REPAIR_PATH_FORBIDDEN")};
let auditFail=false,otpCounter=100000;
const adapter=new Proxy(db,{get(target,key){if(key==="$transaction")return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==="auditLog"&&auditFail)return {create:async(args)=>{if(auditFail===true||auditFail===args.data.action)throw Error("SYNTHETIC_CRITICAL_AUDIT_FAILURE");return t.auditLog.create(args)}};const v=t[k];return typeof v==="function"?v.bind(t):v;}})),options).catch(error=>{const names=String(error.message).match(/\b(?:[A-Z][A-Z_]{5,}|P[0-9]{4})\b/g)||[];console.log("MM_OPERATION_FAILURE:"+error.name+":"+String(error.code||"none")+":"+names.filter(x=>/^(COMMERCIAL_|QUOTATION_|DRAFT_|EXPLICIT_|OTP_|SENT_|SELF_|IDEMPOTENCY_|P[0-9])/.test(x)).join(":"));throw error;});const v=target[key];return typeof v==="function"?v.bind(target):v;}});
const baseLoad=loadWith({"../lib/prisma.js":{prisma:adapter},"./field-engine.service.js":{getUserBusinessId:never}});
const delivery=baseLoad("services/commercial-delivery.service.ts"),load=loadWith({"../lib/prisma.js":{prisma:adapter},"./field-engine.service.js":{getUserBusinessId:never},"./commercial-delivery.service.js":{...delivery,newOtp:()=>String(++otpCounter),sendCommercialEmail:async p=>{emails.push(p)}},"../services/auth.service.js":{verifyToken:token=>jwt.verify(token,"synthetic-jwt-signature-only-32-characters"),getUserById:userId=>db.user.findUnique({where:{id:userId}})}});
const quotes=load("services/quotation.service.ts"),customer=load("services/quotation-customer.service.ts"),finance=load("services/commercial-finance.service.ts");
const owner={userId:"phasec-owner",businessId:"phasec-A"},manager={userId:"phasec-manager",businessId:"phasec-A"},accountant={userId:"phasec-finance",businessId:"phasec-A"};
const actions=["quotation.read","quotation.create","quotation.update","quotation.send","quotation.approve","invoice.read","invoice.issue","payment.read","payment.record","payment.reverse","commercial.policy.manage"];
const config={version:"v1",currency:{code:"INR",decimalPlaces:2},timezone:"Asia/Kolkata",approval:{mode:"enabled",percentageThreshold:"10"},zeroSubtotal:"require_approval"};
const deliveryConfig={version:"v1",linkMinutes:60,otpMinutes:5,maxAttempts:3,maxResends:3,resendSeconds:30,invoiceDueDays:30,invoiceIssuerUserId:accountant.userId};
let server,origin,legacyCalls=0;
const input=(suffix="")=>({contactId:"phasec-contact-A",dealId:null,ownerUserId:owner.userId,issueDate:new Date(Date.now()-86400000).toISOString(),validUntil:new Date(Date.now()+7*86400000).toISOString(),terms:"Synthetic terms",notes:suffix,pricing:{items:[{position:"0",description:"Synthetic service",quantity:"1",unitPrice:"100",taxRate:"18"}]}});
const key=()=>randomUUID();
async function create(discount){const i=input();if(discount)i.pricing.discount={percentage:discount};return quotes.createQuotation(owner,key(),i);}
async function send(q){const result=await customer.sendQuotation(owner,q.quotationId,key(),{expectedVersion:q.version,expectedRevisionVersion:q.revisionVersion,snapshotId:q.snapshotId});assert.equal(result.state,"sent");const msg=emails.at(-1),token=msg.text.match(/\/quotation\/review#([A-Za-z0-9_-]{43})/)[1];return token;}
async function otp(token,action="accepted"){await customer.requestCustomerOtp(token,{action});return emails.at(-1).text.match(/ is (\d{6})\./)[1];}
async function accepted(){const q=await create(),token=await send(q),code=await otp(token);const result=await customer.verifyCustomerDecision(token,{action:"accepted",code});return {q,token,code,...result};}
before(async()=>{
 let stage="identity";try{
 const [identity]=await db.$queryRaw`SELECT current_database() AS db,current_user AS actor,current_setting('server_version_num')::int/10000 AS version,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`;
 console.log("MM_IDENTITY_TYPES:"+typeof identity.version+":"+String(identity.marker===`MM_PHASEC_DISPOSABLE:${run}:${attempt}`));
 assert.deepEqual(identity,{db:expectedDb,actor:"mm_phasec",version:17,marker:`MM_PHASEC_DISPOSABLE:${run}:${attempt}`});
 stage="users";
 for(const [userId,role] of [[owner.userId,"owner"],[manager.userId,"sales_manager"],[accountant.userId,"finance"],["phasec-foreign","owner"],["phasec-disabled","owner"]])await db.user.create({data:{id:userId,email:userId+"@example.invalid",passwordHash:"synthetic-not-login",role,isDisabled:userId==="phasec-disabled"}});
 stage="businesses";
 for(const biz of ["phasec-A","phasec-B"])await db.business.create({data:{id:biz,name:"Synthetic "+biz,ownerUserId:owner.userId,isTrial:true,plan:"trial",planStatus:"trial",licenseStatus:"trial",trialStartDate:new Date(Date.now()-86400000),trialEndsAt:new Date(Date.now()+86400000*30),settings:{commercial:config,commercialDelivery:deliveryConfig,moduleAccess:{customized:true,enabled:["quotations","finance"]}}}});
 stage="memberships";
 for(const [userId,role,businessId] of [[owner.userId,"owner","phasec-A"],[manager.userId,"sales_manager","phasec-A"],[accountant.userId,"finance","phasec-A"],["phasec-foreign","owner","phasec-B"],["phasec-disabled","owner","phasec-A"]])await db.businessMember.create({data:{userId,businessId,role,permissions:{customized:true,modules:["quotations","finance"],commercialActions:actions}}});
 stage="team";
 await db.team.create({data:{id:"phasec-team",name:"Synthetic team",ownerId:manager.userId}});
 await db.teamMember.createMany({data:[{teamId:"phasec-team",userId:manager.userId,role:"manager"},{teamId:"phasec-team",userId:owner.userId,role:"sales_executive"}]});
 stage="contacts";
 await db.contact.create({data:{id:"phasec-contact-A",businessId:owner.businessId,userId:owner.userId,name:"Synthetic customer",email:"synthetic@example.invalid",tags:[]}});
 await db.contact.create({data:{id:"phasec-contact-B",businessId:"phasec-B",userId:owner.userId,name:"Foreign synthetic",tags:[]}});
 stage="http";
 const app=express();app.use(express.json({limit:"64kb"}));app.use("/api/quotations",load("routes/quotation.routes.ts").quotationRouter);app.use("/api/commercial",load("routes/commercial-finance.routes.ts").commercialFinanceRouter);app.use("/api/quotation-customer",load("routes/quotation-customer.routes.ts").quotationCustomerRouter);app.use((_r,res)=>{legacyCalls++;res.status(500).end()});
 server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));origin="http://127.0.0.1:"+server.address().port;
}catch(error){console.log("MM_SETUP_FAILURE:"+stage+":"+error.name+":"+String(error.code||"none"));const detail=String(error.message).match(/Argument `([A-Za-z]+)` is missing|Unknown argument `([A-Za-z]+)`/);if(detail)console.log("MM_SAFE_FIELD:"+(detail[1]||detail[2]));throw error;}
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.$disconnect();});
test("real PostgreSQL draft snapshots are complete/sealed and replay exactly once",async()=>{const i=input(),k=key(),a=await quotes.createQuotation(owner,k,i),b=await quotes.createQuotation(owner,k,i);assert.equal(a.quotationId,b.quotationId);assert.equal(await db.quotationRevisionItem.count({where:{snapshotId:a.snapshotId}}),1);await assert.rejects(quotes.createQuotation(owner,k,{...i,notes:"changed"}),/IDEMPOTENCY_KEY_CONFLICT/);});
test("actual HTTP chain rejects missing/foreign/disabled membership and foreign references",async()=>{for(const [userId,business,contact,expected] of [["phasec-foreign","phasec-A","phasec-contact-A",403],["phasec-disabled","phasec-A","phasec-contact-A",401],[owner.userId,"phasec-B","phasec-contact-A",403],[owner.userId,"phasec-A","phasec-contact-B",403]]){const token=jwt.sign({userId,tv:0,portal:"customer"},"synthetic-jwt-signature-only-32-characters");const r=await fetch(origin+"/api/quotations",{method:"POST",headers:{authorization:"Bearer "+token,"x-business-id":business,"idempotency-key":key(),"content-type":"application/json"},body:JSON.stringify({...input(),contactId:contact}),signal:AbortSignal.timeout(5000)});assert.equal(r.status,expected);}assert.equal(legacyCalls,0);});
test("approval binds revision; self approval fails; authorized manager approves",async()=>{const q=await create("20"),payload={expectedVersion:q.version,expectedRevisionVersion:q.revisionVersion,snapshotId:q.snapshotId,reason:"Synthetic manager approval"};const submitted=await quotes.requestQuotationApproval(owner,q.quotationId,key(),payload);await assert.rejects(quotes.requestQuotationApproval(owner,q.quotationId,key(),{...payload,expectedVersion:submitted.version},"approved"),/SELF_APPROVAL_FORBIDDEN/);const approved=await quotes.requestQuotationApproval(manager,q.quotationId,key(),{...payload,expectedVersion:submitted.version},"approved");assert.equal(approved.approvalState,"approved");});
test("customer acceptance creates exactly one unpaid invoice with zero synthetic payments",async()=>{const a=await accepted();assert(a.invoiceId);const invoice=await db.invoice.findUnique({where:{id:a.invoiceId}});assert.equal(invoice.status,"sent");assert.equal(invoice.total.toFixed(2),"118.00");assert.equal(invoice.paidAt,null);assert.equal(await db.payment.count({where:{invoiceId:a.invoiceId}}),0);const again=await customer.verifyCustomerDecision(a.token,{action:"accepted",code:a.code});assert.equal(again.invoiceId,a.invoiceId);assert(again.replayed);assert.equal(await db.quotationInvoiceConversion.count({where:{quotationId:a.q.quotationId}}),1);});
test("customer decision binding, wrong OTP attempts and replay rejection persist",async()=>{const q=await create(),token=await send(q),code=await otp(token,"rejected");await assert.rejects(customer.verifyCustomerDecision(token,{action:"accepted",code}),/OTP_UNAVAILABLE/);const wrong=code==="000000"?"000001":"000000";await assert.rejects(customer.verifyCustomerDecision(token,{action:"rejected",code:wrong}),/OTP_INVALID/);const a=await db.quotationCustomerAccess.findUnique({where:{tokenHash:delivery.tokenHash(token)}});assert.equal((await db.quotationOtpChallenge.findUnique({where:{accessId:a.id}})).attempts,1);const declined=await customer.verifyCustomerDecision(token,{action:"rejected",code});assert.equal(declined.invoiceId,null);assert.equal(await db.invoice.count({where:{sourceId:q.quotationId}}),0);});
test("partial/full/reversed manual payments preserve ledger and balance",async()=>{const a=await accepted(),pay=(amount)=>({amount,method:"bank",reference:null,notes:"Synthetic payment",paidAt:new Date().toISOString()});const p=await finance.recordCommercialPayment(accountant,a.invoiceId,key(),pay("30"));assert.equal(p.outstandingBalance,"88.00");const p2=await finance.recordCommercialPayment(accountant,a.invoiceId,key(),pay("88"));assert.equal(p2.status,"paid");const reverse=await finance.reverseCommercialPayment(accountant,a.invoiceId,p.paymentId,key(),{reason:"Synthetic correction"});assert.equal(reverse.outstandingBalance,"30.00");assert.equal(reverse.status,"sent");assert.equal(reverse.paidAt,null);await assert.rejects(finance.reverseCommercialPayment(accountant,a.invoiceId,p.paymentId,key(),{reason:"duplicate"}),/PAYMENT_REVERSAL_CONFLICT/);assert.equal((await finance.getCommercialInvoice(accountant,a.invoiceId)).history.length,3);});
test("legacy/direct Finance mutations cannot corrupt commercial invoices/payments",async()=>{const a=await accepted();await assert.rejects(db.invoice.update({where:{id:a.invoiceId},data:{status:"paid"}}),/COMMERCIAL_FINANCE_ROUTE_REQUIRED/);await assert.rejects(db.invoice.delete({where:{id:a.invoiceId}}),/COMMERCIAL_INVOICE_RETAINED/);await assert.rejects(db.payment.create({data:{businessId:owner.businessId,userId:owner.userId,invoiceId:a.invoiceId,amount:"118",method:"cash"}}),/COMMERCIAL_FINANCE_ROUTE_REQUIRED/);});
test("critical real audit failure rolls back draft writes and sequence allocation",async()=>{const before=await db.quotation.count();auditFail=true;try{await assert.rejects(create(),/SYNTHETIC_CRITICAL_AUDIT_FAILURE/);}finally{auditFail=false;}assert.equal(await db.quotation.count(),before);});
test("concurrent acceptance returns one invoice or a fail-closed serialization conflict",async()=>{const q=await create(),token=await send(q),code=await otp(token);const results=await Promise.allSettled([customer.verifyCustomerDecision(token,{action:"accepted",code}),customer.verifyCustomerDecision(token,{action:"accepted",code})]);assert(results.some(r=>r.status==="fulfilled"));for(const r of results)if(r.status==="rejected")assert.match(r.reason.message,/COMMERCIAL_TRANSACTION_CONFLICT/);assert.equal(await db.quotationInvoiceConversion.count({where:{quotationId:q.quotationId}}),1);});
test("concurrent payments cannot exceed outstanding balance",async()=>{const a=await accepted(),payload={amount:"100",method:"cash",reference:null,notes:"Synthetic concurrent",paidAt:new Date().toISOString()};const results=await Promise.allSettled([finance.recordCommercialPayment(accountant,a.invoiceId,key(),payload),finance.recordCommercialPayment(accountant,a.invoiceId,key(),payload)]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);for(const r of results)if(r.status==="rejected")assert.match(r.reason.message,/COMMERCIAL_TRANSACTION_CONFLICT|PAYMENT_EXCEEDS_OUTSTANDING/);assert.equal((await finance.getCommercialInvoice(accountant,a.invoiceId)).paidAmount,"100.00");});
test("post-send editing and content insertion reject; historical content remains",async()=>{const q=await create(),token=await send(q);await assert.rejects(db.quotationRevision.update({where:{id:q.revisionId},data:{terms:"tampered"}}),/SENT_REVISION_IMMUTABLE/);await assert.rejects(db.quotationRevisionItem.create({data:{businessId:owner.businessId,snapshotId:q.snapshotId,position:"1",description:"append",quantity:"1",unitPrice:"1",taxRate:"0",discountInput:{},calculation:{}}}),/COMMERCIAL_SNAPSHOT_SEALED|COMMERCIAL_CONTENT_INSERT_FORBIDDEN/);assert.equal((await customer.viewCustomerQuotation(token)).pricing.grandTotal,"118.00");});

for(const sealFirst of [false,true])test(`independent insertion cannot see uncommitted snapshot (${sealFirst?"sealed":"not yet sealed"}); original trigger-lock scenario remains UNVERIFIED`,async()=>{
 const q=await create(),started={};started.promise=new Promise(r=>started.resolve=r);const release={};release.promise=new Promise(r=>release.resolve=r);let sid;
 const creator=db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "QuotationRevision" WHERE "id"=${q.revisionId} FOR UPDATE`;
  const old=await tx.quotationPricingSnapshot.findUnique({where:{id:q.snapshotId}});
  await tx.quotationRevision.update({where:{id:q.revisionId},data:{version:{increment:1}}});
  const {id:oldId,createdAt,sealedAt,...payload}=old;const snap=await tx.quotationPricingSnapshot.create({data:{...payload,revisionVersion:2}});sid=snap.id;
  await tx.quotationRevisionItem.create({data:{businessId:owner.businessId,snapshotId:sid,position:"0",description:"Synthetic",quantity:"1",unitPrice:"100",taxRate:"18",discountInput:{},calculation:{}}});
  if(sealFirst)await tx.quotationPricingSnapshot.update({where:{id:sid},data:{sealedAt:new Date()}});
  started.resolve();await release.promise;
  if(!sealFirst)await tx.quotationPricingSnapshot.update({where:{id:sid},data:{sealedAt:new Date()}});
  await tx.quotationRevision.update({where:{id:q.revisionId},data:{currentSnapshotId:sid}});
 },{timeout:15000});
 await started.promise;
 try{await assert.rejects(db.quotationRevisionItem.create({data:{businessId:owner.businessId,snapshotId:sid,position:"1",description:"Concurrent synthetic",quantity:"1",unitPrice:"1",taxRate:"0",discountInput:{},calculation:{}}}),/COMMERCIAL_CONTENT_INSERT_FORBIDDEN/);}finally{release.resolve();}
 await creator;
 assert.equal(await db.quotationRevisionItem.count({where:{snapshotId:sid}}),1);
 await assert.rejects(db.quotationRevisionItem.create({data:{businessId:owner.businessId,snapshotId:sid,position:"1",description:"Post-commit synthetic",quantity:"1",unitPrice:"1",taxRate:"0",discountInput:{},calculation:{}}}),/COMMERCIAL_SNAPSHOT_SEALED/);
});

test("OTP expiry, resend throttle and stale code rejection",async()=>{
 const q=await create(),token=await send(q),code=await otp(token);const a=await db.quotationCustomerAccess.findUnique({where:{tokenHash:delivery.tokenHash(token)}});
 await assert.rejects(customer.requestCustomerOtp(token,{action:"accepted"}),/OTP_RESEND_LIMIT/);
 await db.quotationOtpChallenge.update({where:{accessId:a.id},data:{lastSentAt:new Date(Date.now()-31000)}});const next=await otp(token);assert.notEqual(next,code);
 await assert.rejects(customer.verifyCustomerDecision(token,{action:"accepted",code}),/OTP_INVALID/);
 await db.quotationOtpChallenge.update({where:{accessId:a.id},data:{expiresAt:new Date(Date.now()-1000)}});await assert.rejects(customer.verifyCustomerDecision(token,{action:"accepted",code:next}),/OTP_UNAVAILABLE/);
});
test("attempt exhaustion persists and customer cannot change decision",async()=>{
 const q=await create(),token=await send(q),code=await otp(token);const wrong=code==="000000"?"000001":"000000";
 for(let i=0;i<3;i++)await assert.rejects(customer.verifyCustomerDecision(token,{action:"accepted",code:wrong}),/OTP_INVALID/);
 await assert.rejects(customer.verifyCustomerDecision(token,{action:"accepted",code}),/OTP_UNAVAILABLE/);
});
test("critical acceptance audit failure rolls back invoice, consumption and challenge use",async()=>{
 const q=await create(),token=await send(q),code=await otp(token),before=await db.invoice.count();auditFail="quotation.customer.accepted";
 try{await assert.rejects(customer.verifyCustomerDecision(token,{action:"accepted",code}),/SYNTHETIC_CRITICAL_AUDIT_FAILURE/);}finally{auditFail=false;}
 assert.equal(await db.invoice.count(),before);const a=await db.quotationCustomerAccess.findUnique({where:{tokenHash:delivery.tokenHash(token)}});assert.equal(a.consumedAt,null);assert.equal((await db.quotationOtpChallenge.findUnique({where:{accessId:a.id}})).usedAt,null);
 const retry=await customer.verifyCustomerDecision(token,{action:"accepted",code});assert(retry.invoiceId);
});
test("foreign business cannot read or pay another tenant invoice",async()=>{
 const a=await accepted(),foreign={userId:"phasec-foreign",businessId:"phasec-B"};await assert.rejects(finance.getCommercialInvoice(foreign,a.invoiceId),/COMMERCIAL_INVOICE_NOT_FOUND/);
 await assert.rejects(finance.recordCommercialPayment(foreign,a.invoiceId,key(),{amount:"1",method:"cash",reference:null,notes:"synthetic",paidAt:new Date().toISOString()}),/COMMERCIAL_INVOICE_NOT_FOUND/);assert.equal(await db.payment.count({where:{invoiceId:a.invoiceId}}),0);
});
test("concurrent draft updates reject stale versions and retain original snapshot",async()=>{
 const q=await create(),payload={...input(),expectedVersion:q.version,expectedRevisionVersion:q.revisionVersion};const results=await Promise.allSettled([quotes.editQuotationDraft(owner,q.quotationId,key(),{...payload,notes:"one"}),quotes.editQuotationDraft(owner,q.quotationId,key(),{...payload,notes:"two"})]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);for(const r of results)if(r.status==="rejected")assert.match(r.reason.message,/COMMERCIAL_TRANSACTION_CONFLICT|QUOTATION_VERSION_CONFLICT|DRAFT_VERSION_CONFLICT/);assert(await db.quotationPricingSnapshot.findUnique({where:{id:q.snapshotId}}));
});
test("billing denies locked business without resolver repairs or writes",async()=>{
 const count=await db.quotation.count();await db.business.update({where:{id:owner.businessId},data:{isLocked:true}});
 try{await assert.rejects(create(),/COMMERCIAL_BILLING_DENIED/);}finally{await db.business.update({where:{id:owner.businessId},data:{isLocked:false}});}assert.equal(await db.quotation.count(),count);
});
test("revoked explicit grant denies mutation; policy changes stale drafts but retain sent snapshots",async()=>{
 const member=await db.businessMember.findUnique({where:{businessId_userId:{businessId:owner.businessId,userId:owner.userId}}});await db.businessMember.update({where:{id:member.id},data:{permissions:{...member.permissions,commercialActions:[]}}});
 try{await assert.rejects(create(),/grant|Commercial|permission|Explicit/i);}finally{await db.businessMember.update({where:{id:member.id},data:{permissions:member.permissions}});}
 const draft=await create("20"),sent=await create(),token=await send(sent),configuration=load("services/commercial-configuration.service.ts");
 const changed=await configuration.setCommercialConfiguration(owner,key(),{expectedPolicyVersion:"v1",commercial:{...config,version:"v2"},commercialDelivery:deliveryConfig,reason:"Synthetic policy change"});assert.equal(changed.policyVersion,"v2");assert.equal((await db.quotationRevision.findUnique({where:{id:draft.revisionId}})).approvalState,"stale");assert.equal((await customer.viewCustomerQuotation(token)).pricing.grandTotal,"118.00");
 await configuration.setCommercialConfiguration(owner,key(),{expectedPolicyVersion:"v2",commercial:{...config,version:"v3"},commercialDelivery:deliveryConfig,reason:"Synthetic next policy"});
});
