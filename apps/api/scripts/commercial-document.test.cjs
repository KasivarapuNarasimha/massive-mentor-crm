// Offline, actual source modules; no application startup or database connection.
const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),path=require("node:path"),{createRequire}=require("node:module");
const req=createRequire(path.resolve(__dirname,"../package.json")),ts=req("typescript"),{Prisma}=req("@prisma/client");
function loader(overrides={}) {
  const cache=new Map();
  function load(file) {
    file=path.resolve(__dirname,"../src",file);
    if(cache.has(file))return cache.get(file);
    const module={exports:{}};cache.set(file,module.exports);
    const js=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function("require","module","exports",js)(name=>{
      if(name in overrides)return overrides[name];
      if(name==="@prisma/client")return {Prisma};
      if(name.startsWith("node:"))return require(name);
      if(name.startsWith("."))return load(path.relative(path.resolve(__dirname,"../src"),path.resolve(path.dirname(file),name.replace(/\.js$/, ".ts"))));
      if(name==="express")return req(name);
      throw Error("Unexpected dependency "+name);
    },module,module.exports);
    cache.set(file,module.exports);return module.exports;
  }
  return load;
}
const doc=loader()("services/commercial-document.service.ts");
const config=()=>({version:"v1",currency:{code:"INR",decimalPlaces:2},timezone:"Asia/Kolkata",approval:{mode:"enabled",percentageThreshold:"10",amountThreshold:"50"},zeroSubtotal:"require_approval"});
const line=(position="0",price="100")=>({position,description:"Consulting",quantity:"1",unitPrice:price,taxRate:"18"});
const price=(discount)=>doc.normalizeQuoteInput({items:[line()],discount},doc.parseCommercialConfiguration(config())).pricingOutput;
test("approval equality does not exceed percentage or amount",()=>{
  const p=doc.parseCommercialConfiguration(config());assert.equal(doc.approvalRequired(p,price({percentage:"10"})),false);
  assert.equal(doc.approvalRequired(p,price({fixedAmount:"10.01"})),true);
  const amount=doc.parseCommercialConfiguration({...config(),approval:{mode:"enabled",amountThreshold:"10"}});
  assert.equal(doc.approvalRequired(amount,price({fixedAmount:"10"})),false);
  assert.equal(doc.approvalRequired(amount,price({fixedAmount:"10.01"})),true);
});
test("exact discount ratio can exceed a displayed-equal threshold",()=>{
  const p=doc.parseCommercialConfiguration({...config(),approval:{mode:"enabled",percentageThreshold:"10"}});
  assert.equal(doc.approvalRequired(p,{originalSubtotal:"1000000.00",totalDiscount:"100000.01"}),true);
});
test("zero subtotal has no implicit approval outcome",()=>{
  const c=config();delete c.zeroSubtotal;const p=doc.parseCommercialConfiguration(c);
  assert.throws(()=>doc.approvalRequired(p,{originalSubtotal:"0.00",totalDiscount:"0.00"}),/ZERO_SUBTOTAL_POLICY_REQUIRED/);
  assert.equal(doc.approvalRequired(doc.parseCommercialConfiguration(config()),{originalSubtotal:"0.00",totalDiscount:"0.00"}),true);
});
for(const [label,change] of [
  ["missing policy",()=>undefined],["missing currency",c=>{delete c.currency;return c;}],
  ["missing timezone",c=>{delete c.timezone;return c;}],["invalid timezone",c=>({...c,timezone:"Mars/Test"})],
  ["missing threshold",c=>({...c,approval:{mode:"enabled"}})],
  ["ambiguous disabled policy",c=>({...c,approval:{mode:"disabled",amountThreshold:"1"}})],
  ["numeric percentage",c=>({...c,approval:{mode:"enabled",percentageThreshold:10}})],
  ["unsupported currency precision",c=>({...c,currency:{code:"INR",decimalPlaces:3}})]
])test("fail closed: "+label,()=>assert.throws(()=>doc.parseCommercialConfiguration(change(config()))));
test("explicit disabled approval does not invent a threshold",()=>assert.equal(doc.approvalRequired(doc.parseCommercialConfiguration({...config(),approval:{mode:"disabled"}}),price({percentage:"99"})),false));
test("timezone boundary determines the business year",()=>{
  const t=new Date("2025-12-31T20:00:00.000Z");assert.equal(doc.commercialYear(t,"Asia/Kolkata"),2026);assert.equal(doc.commercialYear(t,"America/New_York"),2025);
});
test("canonical keys, NFC and line endings hash deterministically",()=>{
  assert.equal(doc.contentHash({b:"e\u0301\r\n",a:"1.00"}),doc.contentHash({a:"1.00",b:"é\n"}));
  assert.notEqual(doc.contentHash({a:"1.00"}),doc.contentHash({a:"1.01"}));
});
test("canonical numeric, undefined, Date and invalid Unicode values rejected",()=>{
  for(const v of [1,NaN,Infinity,undefined,new Date(),{amount:1},{v:undefined},"\ud800"]) assert.throws(()=>doc.canonical(v));
});
test("closed input rejects client currency, totals and unknown discounts",()=>{
  const c=doc.parseCommercialConfiguration(config());for(const extra of [{currency:"USD"},{grandTotal:"1"}])assert.throws(()=>doc.normalizeQuoteInput({items:[line()],...extra},c));
  assert.throws(()=>doc.normalizeQuoteInput({items:[line()],discount:{fixed:"1"}},c));
});
test("normalized items preserve fixedAmount and immutable numeric ordering",()=>{
  const c=doc.parseCommercialConfiguration(config());const r=doc.normalizeQuoteInput({items:[line("10"),line("2")],discount:{fixedAmount:"0.01"}},c);
  assert.equal(r.items[0].position,"2");assert.equal(r.pricingOutput.quoteFixedDiscount,"0.01");assert.equal(r.items[0].quantity,"1.0000");
});
function fixture({auditFail=false,deny=false}={}) {
  let state={quotes:[],revisions:[],snapshots:[],items:[],events:[],audits:[],requests:[],approvals:[],sequence:0};
  const calls=[];
  const tx={
    async $queryRaw(){calls.push("SELECT lock");return []},
    async $executeRaw(){calls.push("SELECT advisory lock");return 1},
    business:{async findUniqueOrThrow(){return {settings:{commercial:config()}}}},
    businessMember:{async findUnique(){return {user:{isDisabled:false}}}},
    contact:{async findFirstOrThrow(){return {id:"contactA",name:"Synthetic",email:"test@example.invalid",phone:null,company:null}}},
    quotationSequence:{async upsert(){return {lastValue:++state.sequence}}},
    quotation:{async create({data}){const q={id:"q1",version:1,...data};state.quotes.push(q);return q},async update({data}){Object.assign(state.quotes[0],data);return state.quotes[0]},async updateMany({where,data}){if(state.quotes[0].version!==where.version)return {count:0};state.quotes[0].version++;return {count:1}},async findFirst(){return state.quotes[0]}},
    quotationRevision:{async create({data}){const r={id:"r1",version:1,state:"draft",sentAt:null,quotationId:"q1",...data};state.revisions.push(r);return r},async update({data}){Object.assign(state.revisions[0],data);return state.revisions[0]},async findFirst(){return state.revisions[0]},async updateMany({where,data}){const r=state.revisions[0];if(r.version!==where.version||r.currentSnapshotId!==where.currentSnapshotId||r.approvalState!==where.approvalState)return {count:0};Object.assign(r,data);return {count:1}}},
    quotationPricingSnapshot:{async create({data}){const r={id:"s1",...data};state.snapshots.push(r);return r},async update(){state.snapshots[0].sealedAt=new Date();return state.snapshots[0]},async findFirst(){return {...state.snapshots[0],revision:state.revisions[0]}}},
    quotationRevisionItem:{async findMany(){return state.items.map(i=>({...i,quantity:new Prisma.Decimal(i.quantity),unitPrice:new Prisma.Decimal(i.unitPrice),taxRate:new Prisma.Decimal(i.taxRate)}))},async createMany({data}){state.items.push(...data);return {count:data.length}}},
    quotationApprovalHistory:{async create({data}){state.approvals.push(data);return data}},
    quotationEvent:{async create({data}){state.events.push(data);return data}},
    auditLog:{async create({data}){if(auditFail)throw Error("synthetic audit failure");state.audits.push(data);return data}},
    commercialMutationRequest:{async findUnique({where}){const w=where.businessId_actorUserId_operation_key;return state.requests.find(r=>r.key===w.key&&r.operation===w.operation&&r.actorUserId===w.actorUserId)??null},async create({data}){state.requests.push(data);return data}}
  };
  const root={$transaction:async(fn,options)=>{assert.equal(options.isolationLevel,"Serializable");const old=structuredClone(state);try{return await fn(tx)}catch(e){state=old;throw e}}};
  const load=loader({"../lib/prisma.js":{prisma:root},"./commercial-access.service.js":{
    CommercialAccessError:class extends Error{},
    async resolveCommercialActionAccess(u,b,m,a,client){assert.equal(client,tx);calls.push(a);if(deny)throw Error("authorization denied");return {userId:u,businessId:b,role:"owner",permissions:{}}},
    async assertCommercialReferences(u,b,input,m,client,action){assert.equal(client,tx);assert.equal(b,"A");assert.equal(input.contactId,"contactA");calls.push("references:"+action)},
    async buildCommercialReferenceScope(){return {contactWhere:{},dealWhere:{}}}
  },"./commercial-billing-access.service.js":{async evaluateCommercialBillingAccess(c,client){assert.equal(client,tx);return {allowed:true}}}});
  return {service:load("services/quotation.service.ts"),state:()=>state,calls};
}
const input=()=>({contactId:"contactA",dealId:"dealA",ownerUserId:"ownerA",issueDate:"2026-01-01T00:00:00.000Z",validUntil:"2026-02-01T00:00:00.000Z",terms:"Terms",notes:"",pricing:{items:[line()]}});
test("actual create service seals server-priced snapshot and audits in caller transaction",async()=>{
  const f=fixture();const r=await f.service.createQuotation({userId:"ownerA",businessId:"A"},"key1",input());
  assert.equal(r.pricing.grandTotal,"118.00");assert.equal(f.state().audits.length,1);assert.equal(f.state().events.length,1);assert.equal(f.state().requests.length,1);assert(f.state().snapshots[0].sealedAt);
  assert(f.calls.includes("references:quotation.create"));assert(!f.calls.includes("quotation.update"));
});
test("critical audit failure rolls back synthetic transaction state and sequence",async()=>{
  const f=fixture({auditFail:true});await assert.rejects(f.service.createQuotation({userId:"ownerA",businessId:"A"},"key1",input()),/synthetic audit failure/);
  for(const k of ["quotes","revisions","snapshots","items","events","audits","requests"])assert.equal(f.state()[k].length,0);assert.equal(f.state().sequence,0);
});
test("authorization failure executes no business mutation",async()=>{
  const f=fixture({deny:true});await assert.rejects(f.service.createQuotation({userId:"ownerA",businessId:"A"},"key1",input()),/authorization denied/);assert.equal(f.state().sequence,0);assert.equal(f.state().quotes.length,0);
});
test("same idempotency request replays once; different content conflicts",async()=>{
  const f=fixture(),actor={userId:"ownerA",businessId:"A"};const a=await f.service.createQuotation(actor,"key1",input());const b=await f.service.createQuotation(actor,"key1",input());assert.equal(a.snapshotId,b.snapshotId);assert.equal(f.state().sequence,1);
  await assert.rejects(f.service.createQuotation(actor,"key1",{...input(),notes:"changed"}),/IDEMPOTENCY_KEY_CONFLICT/);
});
test("corrupted replay pricing output fails closed",async()=>{
  const f=fixture(),actor={userId:"ownerA",businessId:"A"};await f.service.createQuotation(actor,"key1",input());f.state().snapshots[0].pricingOutput.grandTotal="1.00";
  await assert.rejects(f.service.createQuotation(actor,"key1",input()),/COMMERCIAL_SNAPSHOT_MISMATCH/);
});

// Loopback-only HTTP tests: real auth middleware (token/user adapters mocked),
// real module/billing guards, controller and service; synthetic Prisma dependencies.
async function httpFixture(change=()=>{}) {
  const express=req("express");
  const f=fixture();
  const state={disabled:false,status:"active",member:true,modules:["quotations"],actions:["quotation.read","quotation.create","quotation.update"],repairs:0};
  change(state);
  const never=()=>{state.repairs++;throw Error("Repair path forbidden")};
  const biz={status:state.status,settings:{commercial:config()},isDemo:false,portalKind:"customer",isLocked:false,isTrial:true,plan:"trial",planStatus:"trial",licenseStatus:"trial",trialStartDate:new Date("2020-01-01T00:00:00.000Z"),trialEndsAt:new Date("2099-01-01T00:00:00.000Z"),subscriptionEndsAt:null};
  const member=(where)=>state.member&&where.businessId_userId.businessId==="A"?{role:"owner",permissions:{modules:state.modules,commercialActions:state.actions},user:{isDisabled:state.disabled},business:biz}:null;
  // Extend the transaction fixture with real authorization SELECT adapters.
  const tx={
    async $queryRaw(){return []},async $executeRaw(){return 1},businessMember:{async findUnique({where}){return member(where)},create:never,update:never,upsert:never},
    business:{async findUnique(){return biz},async findUniqueOrThrow(){return biz},update:never},
    contact:{async findFirst({where}){return where.businessId==="A"&&where.id==="contactA"?{id:"contactA"}:null},async findFirstOrThrow(){return {id:"contactA",name:"Synthetic",email:null,phone:null,company:null}}},
    deal:{async findFirst({where}){return where.businessId==="A"&&where.id==="dealA"?{id:"dealA",contactId:"contactA"}:null}},
    quotationSequence:{async upsert(){return {lastValue:++f.state().sequence}}},
    quotation:{async create({data}){const q={id:"qhttp",version:1,...data};f.state().quotes.push(q);return q},async update(){return f.state().quotes[0]},async findMany(){return []}},
    quotationRevision:{async create({data}){const r={id:"rhttp",version:1,...data};f.state().revisions.push(r);return r},async update(){return f.state().revisions[0]}},
    quotationPricingSnapshot:{async create({data}){const r={id:"shttp",...data};f.state().snapshots.push(r);return r},async update(){return {}}},
    quotationRevisionItem:{async createMany({data}){f.state().items.push(...data);return {count:data.length}}},
    quotationEvent:{async create({data}){f.state().events.push(data);return data}},auditLog:{async create({data}){f.state().audits.push(data);return data}},
    commercialMutationRequest:{async findUnique(){return null},async create({data}){f.state().requests.push(data);return data}}
  };
  const root={...tx,async $transaction(fn){if(state.revokeAtTransaction)state.actions=[];return fn(tx)}};
  const load=loader({"../lib/prisma.js":{prisma:root},"./field-engine.service.js":{getUserBusinessId:never},
    "../services/auth.service.js":{verifyToken:()=>({userId:"ownerA",tv:0,portal:"customer"}),getUserById:async()=>({id:"ownerA",email:"test@example.invalid",role:"super_admin",platformRole:"super_admin",tokenVersion:0,isDisabled:state.disabled})}});
  const app=express();app.use(express.json({limit:"64kb"}));app.use("/quotations",load("routes/quotation.routes.ts").quotationRouter);
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  return {state,f,url:"http://127.0.0.1:"+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
for(const [label,change,business,expected] of [
  ["valid exact member",()=>{},"A",201],
  ["missing membership",s=>s.member=false,"A",403],
  ["foreign business",()=>{},"B",403],
  ["disabled actor",s=>s.disabled=true,"A",401],
  ["inactive business",s=>s.status="inactive","A",403],
  ["module denial",s=>s.modules=[],"A",403],
  ["action denial",s=>s.actions=[],"A",403],
  ["malformed action",s=>s.actions=[42],"A",403],
  ["revocation before transaction",s=>s.revokeAtTransaction=true,"A",403]
])test("real HTTP chain: "+label,async()=>{
  const h=await httpFixture(change);
  try {
    const r=await fetch(h.url+"/quotations",{method:"POST",headers:{Authorization:"Bearer synthetic", "x-business-id":business,"idempotency-key":"http1","Content-Type":"application/json"},body:JSON.stringify(input()),signal:AbortSignal.timeout(5000)});
    assert.equal(r.status,expected,JSON.stringify(await r.json()));assert.equal(h.state.repairs,0);
    if(expected!==201){assert.equal(h.f.state().sequence,0);assert.equal(h.f.state().audits.length,0)}else assert.equal(h.f.state().audits.length,1);
  }finally{await h.close()}
});

test("canonical NFC-equivalent keys reject ambiguous duplicate content",()=>{
  assert.throws(()=>doc.canonical({"é":"a","e\u0301":"b"}),/CANONICAL_KEY_COLLISION/);
});
test("runtime approval decision rejects unknown values before transaction",async()=>{
  const f=fixture();await assert.rejects(f.service.requestQuotationApproval({userId:"ownerA",businessId:"A"},"q1","bad",{},"other"),/INVALID_APPROVAL_DECISION/);
  assert.equal(f.calls.length,0);
});

const approvalInput=(version)=>({expectedVersion:version,expectedRevisionVersion:1,snapshotId:"s1",reason:"Synthetic approval evidence"});
async function discountedFixture(){const f=fixture();await f.service.createQuotation({userId:"ownerA",businessId:"A"},"create",{...input(),pricing:{items:[line()],discount:{percentage:"20"}}});return f;}
test("approval request binds to snapshot and independent approver can approve",async()=>{
  const f=await discountedFixture();const submit=await f.service.requestQuotationApproval({userId:"ownerA",businessId:"A"},"q1","submit",approvalInput(1));assert.equal(submit.approvalState,"pending");
  const approved=await f.service.requestQuotationApproval({userId:"managerA",businessId:"A"},"q1","approve",approvalInput(2),"approved");assert.equal(approved.approvalState,"approved");assert.equal(f.state().approvals.length,2);assert.equal(f.state().audits.length,3);
});
test("quotation creator cannot approve own pending revision",async()=>{
  const f=await discountedFixture();await f.service.requestQuotationApproval({userId:"ownerA",businessId:"A"},"q1","submit",approvalInput(1));
  await assert.rejects(f.service.requestQuotationApproval({userId:"ownerA",businessId:"A"},"q1","approve",approvalInput(2),"approved"),/SELF_APPROVAL_FORBIDDEN/);assert.equal(f.state().revisions[0].approvalState,"pending");assert.equal(f.state().approvals.length,1);
});
test("stale quotation version cannot record approval",async()=>{
  const f=await discountedFixture();await f.service.requestQuotationApproval({userId:"ownerA",businessId:"A"},"q1","submit",approvalInput(1));
  await assert.rejects(f.service.requestQuotationApproval({userId:"managerA",businessId:"A"},"q1","approve",approvalInput(1),"approved"),/QUOTATION_VERSION_CONFLICT/);assert.equal(f.state().approvals.length,1);
});

test("approval rejects stored item drift despite valid envelope hash",async()=>{
  const f=await discountedFixture();f.state().items[0].description="tampered";
  await assert.rejects(f.service.requestQuotationApproval({userId:"ownerA",businessId:"A"},"q1","submit",approvalInput(1)),/COMMERCIAL_ITEM_SNAPSHOT_MISMATCH/);assert.equal(f.state().approvals.length,0);
});
test("approval rejects revision content drift despite valid snapshot hash",async()=>{
  const f=await discountedFixture();f.state().revisions[0].terms="tampered";
  await assert.rejects(f.service.requestQuotationApproval({userId:"ownerA",businessId:"A"},"q1","submit",approvalInput(1)),/COMMERCIAL_REVISION_SNAPSHOT_MISMATCH/);assert.equal(f.state().approvals.length,0);
});

for(const state of ["40001","40P01"])test("raw PostgreSQL conflict "+state+" fails closed after transaction rollback",async()=>{
 const original=new Prisma.PrismaClientKnownRequestError("Synthetic raw lock conflict",{code:"P2010",clientVersion:"6.19.3",meta:{code:state}});
 let calls=0;const service=loader({"../lib/prisma.js":{prisma:{$transaction:async()=>{calls++;throw original}}},"./commercial-access.service.js":{},"./commercial-billing-access.service.js":{}})("services/quotation.service.ts");
 await assert.rejects(service.transaction(async()=>null),error=>error.code==="COMMERCIAL_TRANSACTION_CONFLICT"&&error.status===409);assert.equal(calls,1);
});
test("unrelated raw SQL errors are not disguised as concurrency conflicts",async()=>{
 const original=new Prisma.PrismaClientKnownRequestError("Synthetic constraint error",{code:"P2010",clientVersion:"6.19.3",meta:{code:"23514"}});
 const service=loader({"../lib/prisma.js":{prisma:{$transaction:async()=>{throw original}}},"./commercial-access.service.js":{},"./commercial-billing-access.service.js":{}})("services/quotation.service.ts");await assert.rejects(service.transaction(async()=>null),error=>error===original);
});

test("trusted issuer checks retain tenant and restore caller pin without trusting issuer role",async()=>{
 let strict;const checked=[],tx={$queryRaw:async()=>[]};const load=loader({"../lib/prisma.js":{prisma:{}},"./commercial-access.service.js":{CommercialAccessError:class extends Error{},resolveCommercialActionAccess:async(u,b,m,a,client)=>{assert.equal(client,tx);const pin=strict.getStrictRequestContext(u);assert.equal(pin.businessId,b);checked.push([u,b,a]);if(u==="disabled")throw Error("exact membership denied");return {userId:u,businessId:b,role:"finance",permissions:{}};}},"./commercial-billing-access.service.js":{evaluateCommercialBillingAccess:async()=>({allowed:true})}});
 strict=load("services/strict-request-context.service.ts");const service=load("services/quotation.service.ts"),actor={userId:"owner",businessId:"A"};
 await strict.runWithStrictBusinessContext({...actor,role:"owner",permissions:{}},async()=>{
  await service.authorizeInvoiceIssuer(tx,actor,"finance");assert.equal(strict.getStrictRequestContext(actor.userId).userId,"owner");
  await assert.rejects(service.authorizeInvoiceIssuer(tx,actor,"disabled"),/exact membership denied/);assert.equal(strict.getStrictRequestContext(actor.userId).userId,"owner");
  await assert.rejects(service.authorizeInvoiceIssuer(tx,{...actor,businessId:"B"},"finance"),/Pinned workspace mismatch/);
 });assert.equal(strict.getStrictRequestContext(actor.userId),undefined);assert(checked.every(([,b])=>b==="A"));assert(checked.some(([u,,a])=>u==="finance"&&a==="invoice.issue"));
});
