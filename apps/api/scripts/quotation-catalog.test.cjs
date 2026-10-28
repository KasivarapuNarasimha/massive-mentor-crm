// Offline: actual catalog service with transaction/database boundaries replaced.
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {loadWith,req}=require("./commercial-test-loader.cjs");
function fixture(scope={contactWhere:{assignedTo:"actor"},dealWhere:{userId:"actor"}}){
 const reads=[];let allowed=true;
 const tx={quotation:{findMany:async args=>{reads.push(["quotations",args]);return[];},findFirst:async()=>null},
 contact:{findMany:async args=>{reads.push(["contacts",args]);return[{id:"scoped-contact"}]},findFirst:async()=>null},
 deal:{findMany:async args=>{reads.push(["deals",args]);return[];}}};
 const load=loadWith({
 "./quotation.service.js":{authorize:async(_tx,actor,action)=>{if(!allowed)throw Error("DENIED");reads.push(["authorize",actor.businessId,action]);return{...actor,role:"sales_executive"};},transaction:async fn=>fn(tx),visible:async()=>{}},
 "./commercial-access.service.js":{CommercialAccessError:class extends Error{},buildCommercialReferenceScope:async()=>scope}
 });
 return{service:load("services/quotation-catalog.service.ts"),reads,deny:()=>allowed=false};
}
const actor={userId:"actor",businessId:"tenant-A"};
test("catalog rejects malformed search/status/cursor before reads",async()=>{
 const f=fixture();for(const query of [{status:"paid"},{search:["x"]},{cursor:""},{unknown:"x"},{search:"x".repeat(121)}])await assert.rejects(f.service.searchQuotations(actor,query));assert.equal(f.reads.length,0);
});
test("quotation catalog never reads records when permission is denied",async()=>{const f=fixture();f.deny();await assert.rejects(f.service.searchQuotations(actor,{}),/DENIED/);assert.deepEqual(f.reads,[]);});
test("search scopes contacts, deals and quotations to tenant and sales ownership",async()=>{
 const f=fixture();assert.deepEqual(await f.service.searchQuotations(actor,{search:"Buyer",status:"sent"}),{items:[],nextCursor:null});
 const contacts=f.reads.find(x=>x[0]==="contacts")[1],deals=f.reads.find(x=>x[0]==="deals")[1],quotes=f.reads.find(x=>x[0]==="quotations")[1];
 assert.equal(contacts.where.businessId,"tenant-A");assert.equal(contacts.where.AND[0].assignedTo,"actor");assert.equal(deals.where.businessId,"tenant-A");assert.equal(deals.where.userId,"actor");
 assert.equal(quotes.where.businessId,"tenant-A");assert.equal(quotes.where.ownerUserId,"actor");assert.equal(quotes.take,50);
 const active=quotes.where.AND[1].OR;assert.equal(active[0].currentDraft.is.state,"sent");assert.equal(active[1].currentDraftRevisionId,null);
});
test("foreign or absent cursor fails without unscoped lookup",async()=>{const f=fixture();await assert.rejects(f.service.searchQuotations(actor,{cursor:"foreign"}),/INVALID_QUOTATION_CURSOR/);assert(!f.reads.some(x=>x[0]==="quotations"));});
test("reference selector requires create permission and exact tenant",async()=>{const f=fixture();await f.service.searchQuotationReferences(actor,{kind:"contact",search:"Buyer"});assert.equal(f.reads[0][2],"quotation.create");const args=f.reads[1][1];assert.equal(args.where.businessId,actor.businessId);assert.equal(args.where.deletedAt,null);assert.equal(args.take,25);assert.equal(args.select.email,true);});
test("deal selector refuses foreign contact and never reads deals",async()=>{const f=fixture();await assert.rejects(f.service.searchQuotationReferences(actor,{kind:"deal",contactId:"foreign"}),/CUSTOMER_UNAVAILABLE/);assert(!f.reads.some(x=>x[0]==="deals"));});
test("display statuses preserve terminal states and prioritize conversion",()=>{
 const s=fixture().service,now=new Date("2026-01-02Z"),future=new Date("2026-01-03Z"),past=new Date("2026-01-01Z");
 assert.equal(s.quotationDisplayStatus({state:"sent",approvalState:"not_required",validUntil:past},false,now),"expired");
 assert.equal(s.quotationDisplayStatus({state:"draft",approvalState:"pending",validUntil:future},false,now),"pending_approval");
 assert.equal(s.quotationDisplayStatus({state:"accepted",approvalState:"approved",validUntil:past},false,now),"accepted");
 assert.equal(s.quotationDisplayStatus({state:"accepted",approvalState:"approved",validUntil:past},true,now),"converted");
});
test("shared desktop/mobile/search hierarchy requires explicit quotation module",()=>{
 const ts=req("typescript"),root=path.resolve(__dirname,"../../.."),cache=new Map();
 function load(name){if(cache.has(name))return cache.get(name);const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,"apps/web/lib",name+".ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function("require","exports","module",code)(id=>load(id.replace("./","")),module.exports,module);cache.set(name,module.exports);return module.exports;}
 const nav=load("nav-hierarchy"),permissions=load("module-permissions"),catalog=load("feature-catalog");
 const sales=nav.NAV_HIERARCHY.find(x=>x.id==="crm").subModules.find(x=>x.id==="crm-sales").features;
 assert(sales.findIndex(x=>x.label==="Deals")<sales.findIndex(x=>x.label==="Quotations"));assert(sales.findIndex(x=>x.label==="Quotations")<sales.findIndex(x=>x.label==="Clients"));
 assert.equal(permissions.canAccessPath("/dashboard/quotations",["deals"],{loaded:true}),false);
 assert.equal(permissions.canAccessPath("/dashboard/quotations",["quotations"],{loaded:true}),true);
 assert.equal(nav.findActiveSubModuleId("/dashboard/quotations"),"crm-sales");
 const entry={href:"/dashboard/quotations",label:"Quotations"},stale=[{href:"/dashboard/deals",label:"Deals"}];
 assert.equal(permissions.includeGrantedNavItem(stale,entry,["quotations"]).length,2);
 assert.equal(permissions.includeGrantedNavItem(stale,entry,["deals"]),stale);
 assert.equal(permissions.includeGrantedNavItem(stale,entry,null),stale);
 assert.equal(permissions.includeGrantedNavItem(stale,undefined,["quotations"]),stale);
 const present=[...stale,{...entry,label:"Configured quotations"}];
 assert.equal(permissions.includeGrantedNavItem(present,entry,["quotations"]),present);
 const results=catalog.searchFeatures("Quotations",{modules:["quotations"],canAccess:href=>permissions.canAccessPath(href,["quotations"],{loaded:true})});
 assert.equal(results.length,1);assert.equal(results[0].href,entry.href);assert.equal(results[0].subModuleLabel,"Sales & Pipeline");
 assert.equal(catalog.searchFeatures("Quotations",{modules:["deals"],canAccess:href=>permissions.canAccessPath(href,["deals"],{loaded:true})}).length,0);
 const shell=fs.readFileSync(path.join(root,"apps/web/components/dashboard/DashboardShell.tsx"),"utf8");
 assert(shell.includes("includeGrantedNavItem("));assert(shell.includes('resolveNav(crmNavItems).find((item) => item.href === "/dashboard/quotations")'));
 assert(fs.existsSync(path.join(root,"apps/web/app/dashboard/quotations/page.tsx")));
});

test("manager team OR scope is ANDed with customer search, never overwritten",async()=>{
 const team={OR:[{userId:{in:["actor","peer"]}},{assignedTo:{in:["actor","peer"]}}]},f=fixture({contactWhere:team,dealWhere:{userId:{in:["actor","peer"]}}});
 await f.service.searchQuotationReferences(actor,{kind:"contact",search:"Buyer"});
 const selector=f.reads.find(x=>x[0]==="contacts")[1];assert.deepEqual(selector.where.AND[0],team);assert(selector.where.AND[1].OR);assert.equal(selector.where.OR,undefined);
 const g=fixture({contactWhere:team,dealWhere:{userId:{in:["actor","peer"]}}});await g.service.searchQuotations(actor,{search:"Buyer"});
 const lookup=g.reads.find(x=>x[0]==="contacts")[1];assert.deepEqual(lookup.where.AND[0],team);assert(lookup.where.AND[1].OR);assert.equal(lookup.where.OR,undefined);
});
