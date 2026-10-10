// Actual TypeScript modules loaded without application startup or environment-file loading.
const fs=require("node:fs"),path=require("node:path"),{createRequire}=require("node:module");
const req=createRequire(path.resolve(__dirname,"../package.json")),ts=req("typescript");
exports.req=req;
exports.loadWith=(overrides={})=>{
 const cache=new Map();function load(file){file=path.resolve(__dirname,"../src",file);if(cache.has(file))return cache.get(file);const module={exports:{}};cache.set(file,module.exports);
 const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function("require","module","exports",code)(name=>{if(name in overrides)return overrides[name];if(name.startsWith("node:"))return require(name);if(name.startsWith("."))return load(path.relative(path.resolve(__dirname,"../src"),path.resolve(path.dirname(file),name.replace(/\.js$/, ".ts"))));return req(name);},module,module.exports);cache.set(file,module.exports);return module.exports;}
 return load;
};
