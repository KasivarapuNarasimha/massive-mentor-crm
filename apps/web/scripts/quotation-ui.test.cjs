// Offline SSR of the actual workspace/selectors. No browser or API/database connection.
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{createRequire}=require("node:module");
const root=path.resolve(__dirname,".."),req=createRequire(path.join(root,"package.json")),ts=req("typescript"),React=req("react"),{renderToStaticMarkup}=req("react-dom/server");
function workspace(auth){
 const cache=new Map();
 function load(name){const file=path.join(root,name);if(cache.has(file))return cache.get(file);const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 new Function("require","module","exports",code)(id=>{
 if(id==="@/lib/auth-context")return{useAuth:()=>auth};
 if(id==="@/lib/api")return{API_BASE_URL:"https://synthetic.example.invalid/api"};
 if(id==="next/link")return{__esModule:true,default:({href,children,...props})=>React.createElement("a",{href,...props},children)};
 if(id.startsWith("@/components/"))return load(id.slice(2)+".tsx");
 return req(id);
 },module,module.exports);cache.set(file,module.exports);return module.exports;}
 return renderToStaticMarkup(React.createElement(load("components/quotations/QuotationWorkspace.tsx").default));
}
test("unauthenticated quotation workspace exposes only normal sign-in",()=>{
 const html=workspace({token:null,user:null,isLoading:false});
 assert.match(html,/Sign in to manage quotations/);assert.match(html,/href="\/login"/);
 assert.doesNotMatch(html,/Record payment|Send secure quotation/);
});
test("authenticated quotation UI renders selectors, all lifecycle filters and safe workflow controls",()=>{
 const html=workspace({token:"synthetic-only",user:{id:"synthetic-owner",businessId:"synthetic-business"},isLoading:false});
 for(const value of ["Quotations","Create Quotation","Search quotations","Select customer","Select deal","taxRate","Terms","Notes","Save draft","pending_approval","converted","Customer invoices"])assert(html.includes(value),value+" missing");
 assert(html.includes("Verified customer acceptance automatically creates exactly one unpaid invoice"));
 assert.doesNotMatch(html,/synthetic-only/);
 assert.doesNotMatch(html,/>Send secure quotation/);assert.doesNotMatch(html,/>Download sealed PDF/);
});
