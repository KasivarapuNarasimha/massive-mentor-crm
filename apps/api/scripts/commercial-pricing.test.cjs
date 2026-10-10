// Offline: actual pure pricing implementation, no application or database startup.
const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {createRequire} = require("node:module");
const req = createRequire(path.resolve(__dirname,"../package.json"));
const ts = req("typescript"), {Prisma} = req("@prisma/client");
function load(file) {
  const exports={};
  const source=fs.readFileSync(file,"utf8");
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require(id){if(id==="@prisma/client")return {Prisma};if(id==="../lib/commercial-money.js")return load(path.resolve(__dirname,"../src/lib/commercial-money.ts"));throw Error("Unexpected dependency "+id);}});
  return exports;
}
const {calculateCommercialQuote:calculate}=load(path.resolve(__dirname,"../src/services/commercial-pricing.service.ts"));
const currencies=[{code:"INR",decimalPlaces:2}];
const line=(position="0",unitPrice="1.00",extra={})=>({position,quantity:"1",unitPrice,taxRate:"0",...extra});
const quote=(items,discount)=>calculate({currency:"INR",items,discount},currencies);
test("approved 300 example with stacked discounts and mixed tax",()=>{
  const r=quote([line("0","100",{quantity:"2",taxRate:"18",discount:{percentage:"10",fixedAmount:"10"}}),line("1","100")],{percentage:"10",fixedAmount:"24.30"});
  assert.equal(r.originalSubtotal,"300.00");assert.equal(r.totalDiscount,"81.30");assert.equal(r.taxableBase,"218.70");
  assert.equal(r.tax,"24.79");assert.equal(r.grandTotal,"243.49");assert.equal(r.effectiveDiscountPercentage,"27.1000");
  assert.equal(r.lines[0].quoteFixedAllocation,"15.30");assert.equal(r.lines[1].quoteFixedAllocation,"9.00");
  assert.equal(r.calculationPolicyVersion,"stacked-exclusive-v1");
});
test("cent ties follow immutable position, not array order",()=>{
  const r=quote([line("10"),line("2"),line("7")],{fixedAmount:"0.01"});
  assert.equal(r.lines[1].quoteFixedAllocation,"0.01");assert.equal(r.lines[0].quoteFixedAllocation,"0.00");
  assert.equal(r.grandTotal,"2.99");
});
test("unequal allocation reconciles and never discounts zero-base lines",()=>{
  const r=quote([line("0","0"),line("1","1"),line("2","2")],{fixedAmount:"1"});
  assert.equal(r.lines[0].quoteFixedAllocation,"0.00");assert.equal(r.lines[1].quoteFixedAllocation,"0.33");assert.equal(r.lines[2].quoteFixedAllocation,"0.67");
});
test("half-up line, percentage and tax stages are explicit",()=>{
  const r=quote([line("0","0.01",{quantity:"0.5",taxRate:"50"})]);
  assert.equal(r.originalSubtotal,"0.01");assert.equal(r.tax,"0.01");assert.equal(r.grandTotal,"0.02");
  const d=quote([line("0","0.05")],{percentage:"10"});assert.equal(d.quotePercentageDiscount,"0.01");
});
test("zero original subtotal is not implicit approval; full discount yields zero",()=>{
  const z=quote([line("0","0")]);assert.equal(z.effectiveDiscountRatio,null);assert.equal(z.effectiveDiscountPercentage,null);
  const r=quote([line("0","100",{taxRate:"18"})],{percentage:"100"});assert.equal(r.grandTotal,"0.00");assert.equal(r.tax,"0.00");
});
test("large exact cents and ratio survive JavaScript unsafe integer range",()=>{
  const r=quote([line("0","90071992547409.91")],{fixedAmount:"0.01"});
  assert.equal(r.grandTotal,"90071992547409.90");assert.equal(r.effectiveDiscountRatio.numerator,"1");assert.equal(r.effectiveDiscountRatio.denominator,"9007199254740991");
});
test("discounts cannot exceed remaining line or quote base",()=>{
  for(const d of [{percentage:"100.0001"},{fixedAmount:"1.01"},{percentage:"50",fixedAmount:"0.51"}]){
    assert.throws(()=>quote([line("0","1",{discount:d})]));assert.throws(()=>quote([line()],d));
  }
});
test("invalid inputs and unsupported precision fail rather than coerce",()=>{
  for(const field of ["quantity","unitPrice","taxRate"]){
    for(const value of [1,NaN,Infinity,null,"-1","1e2","01","",{},"0.00001"]){assert.throws(()=>quote([line("0","1",{[field]:value})]));}
  }
  assert.throws(()=>quote([line("0","1",{quantity:"0"})]));
  for(const value of [1,null,"-1","NaN","0.001"]){assert.throws(()=>quote([line()],{fixedAmount:value}));}
  assert.throws(()=>quote([line()],{percentage:10}));
});
test("storage overflow at line, subtotal, tax or grand total is rejected",()=>{
  const max="9999999999999999.99";
  assert.throws(()=>quote([line("0",max,{quantity:"2"})]));
  assert.throws(()=>quote([line("0",max),line("1","0.01")]));
  assert.throws(()=>quote([line("0",max,{taxRate:"200"})]));
  assert.throws(()=>quote([line("0",max,{taxRate:"1"})]));
});
test("explicit configured currencies and unique immutable positions required",()=>{
  assert.throws(()=>calculate({currency:"USD",items:[line()]},currencies));
  assert.throws(()=>calculate({currency:"INR",items:[line()]},[{code:"INR",decimalPlaces:3}]));
  assert.throws(()=>quote([line(),line()]));assert.throws(()=>quote([line("01")]));assert.throws(()=>quote([]));
});
test("arithmetic does not change global Decimal configuration",()=>{
  const before=[Prisma.Decimal.precision,Prisma.Decimal.rounding];quote([line()]);assert.deepEqual([Prisma.Decimal.precision,Prisma.Decimal.rounding],before);
});
