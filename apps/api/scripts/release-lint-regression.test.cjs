// Offline release-lint compatibility checks; no app startup, database or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');
const {test} = require('node:test');
const root = path.resolve(__dirname, '../../..');
const ts = createRequire(path.join(root, 'apps/api/package.json'))('typescript');
const baseline = '39866920756cd6c75ef970fab431433fc96ff9c5';
const reviewedPaths = [
  "apps/api/src/controllers/ai.controller.ts",
  "apps/api/src/controllers/automation.controller.ts",
  "apps/api/src/controllers/business.controller.ts",
  "apps/api/src/controllers/crm.controller.ts",
  "apps/api/src/controllers/integration.controller.ts",
  "apps/api/src/controllers/location.controller.ts",
  "apps/api/src/controllers/report.controller.ts",
  "apps/api/src/controllers/template.controller.ts",
  "apps/api/src/index.ts",
  "apps/api/src/lib/lead-statuses.ts",
  "apps/api/src/lib/password-policy.ts",
  "apps/api/src/scripts/diagnose-hostinger-self-delivery.ts",
  "apps/api/src/scripts/qa-ai-command-accept.ts",
  "apps/api/src/scripts/qa-ai-command-final.ts",
  "apps/api/src/scripts/qa-ai-command-live.ts",
  "apps/api/src/scripts/qa-ai-command.ts",
  "apps/api/src/scripts/qa-erp-e2e.ts",
  "apps/api/src/scripts/qa-password-reset-final.ts",
  "apps/api/src/scripts/verify-email-reuse-after-delete.ts",
  "apps/api/src/scripts/verify-password-reset.ts",
  "apps/api/src/services/ai-command/insights.ts",
  "apps/api/src/services/ai.service.ts",
  "apps/api/src/services/ai/prompt-templates.ts",
  "apps/api/src/services/approval.service.ts",
  "apps/api/src/services/backup.service.ts",
  "apps/api/src/services/commercial-document.service.ts",
  "apps/api/src/services/crm.service.ts",
  "apps/api/src/services/email/brand.ts",
  "apps/api/src/services/erp-sales.service.ts",
  "apps/api/src/services/export-format.service.ts",
  "apps/api/src/services/import-contacts.service.ts",
  "apps/api/src/services/integration.service.ts",
  "apps/api/src/services/media-storage.service.ts",
  "apps/api/src/services/mentor.service.ts",
  "apps/api/src/services/roadmap.service.ts",
  "apps/api/src/services/saas-billing.service.ts",
  "apps/api/src/services/swot.service.ts",
  "apps/api/src/utils/ai-error.ts"
];
const before = p => execFileSync('git', ['show', baseline + ':' + p], {cwd: root, encoding: 'utf8'});
const current = p => fs.readFileSync(path.join(root,p), 'utf8');
function output(source, module) { return ts.transpileModule(source,{compilerOptions:{module,target:ts.ScriptTarget.ES2022,verbatimModuleSyntax:false}}).outputText; }
function imports(source) {
 const ast=ts.createSourceFile('output.js', output(source,ts.ModuleKind.ESNext),ts.ScriptTarget.Latest,true);
 return ast.statements.filter(ts.isImportDeclaration).map(n=>n.moduleSpecifier.text).sort();
}
test('lint fixes preserve compiled module dependencies against fixed reviewed checkpoint',()=>{
 for(const p of reviewedPaths)assert.deepEqual(imports(current(p)), imports(before(p)),p);
});
test('password normalization remains equivalent for every UTF-16 code unit',()=>{
 const p='apps/api/src/lib/password-policy.ts';
 const load=source=>{const exports={};vm.runInNewContext(output(source,ts.ModuleKind.CommonJS),{exports,require});return exports;};
 const old=load(before(p)),next=load(current(p));
 for(let c=0;c<65536;c++){const ch=String.fromCharCode(c);for(const s of [ch+'Password9!'+ch,'Password'+ch+'9!']){
 assert.equal(next.normalizeLoginPassword(s),old.normalizeLoginPassword(s));
 assert.equal(next.passwordContainsWhitespace(s),old.passwordContainsWhitespace(s));
 }}
});
test('disabled integration signatures and error-middleware arity are preserved',()=>{
 const p='apps/api/src/services/integration.service.ts';
 const signatures=source=>{const ast=ts.createSourceFile(p,source,ts.ScriptTarget.Latest,true);return ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['sendGmail','createCalendarEvent'].includes(n.name?.text)).map(n=>[n.name.text,n.parameters.length,n.parameters.some(p=>Boolean(p.dotDotDotToken))]);};
 assert.deepEqual(signatures(current(p)), signatures(before(p)));
 const ast=ts.createSourceFile('index.ts',current('apps/api/src/index.ts'),ts.ScriptTarget.Latest,true);let found=false;
 function visit(n){if(ts.isArrowFunction(n)&&n.parameters[0]?.name.getText(ast)==='err'&&n.parameters[3]?.name.getText(ast)==='_next'){assert.equal(n.parameters.length,4);assert.ok(!n.parameters.some(p=>p.dotDotDotToken));found=true;}ts.forEachChild(n,visit);}visit(ast);assert.ok(found);
});

test('registry lint cleanup leaves emitted runtime byte-identical',()=>{
 const p='apps/api/src/services/ai-command/registry.ts';
 assert.equal(output(current(p),ts.ModuleKind.ESNext),output(before(p),ts.ModuleKind.ESNext));
});


test('permission metadata type narrowing emits identical runtime',()=>{
 const p='apps/api/src/services/ai-command/permissions.ts';
 assert.equal(output(current(p),ts.ModuleKind.ESNext),output(before(p),ts.ModuleKind.ESNext));
});

test('per-action registry rejects mismatched argument contracts at compile time',()=>{
 const api=path.join(root,'apps/api');
 const config=ts.readConfigFile(path.join(api,'tsconfig.json'),ts.sys.readFile);assert.equal(config.error,undefined);
 const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,api,{noEmit:true,incremental:false});
 const virtual=path.join(api,'src/services/ai-command/registry-contract-check.ts');
 const source=`import { ACTION_REGISTRY } from './registry.js';
import type { ActionContext } from './types.js';
declare const ctx: ActionContext;
ACTION_REGISTRY.create_product.execute(ctx, {name:'Synthetic',sku:'SYN'});
// @ts-expect-error product name must be a string
ACTION_REGISTRY.create_product.execute(ctx, {name:42,sku:'SYN'});
// @ts-expect-error normalized product execution requires SKU
ACTION_REGISTRY.create_product.execute(ctx, {name:'Synthetic'});
// @ts-expect-error search contact type is a schema enum
ACTION_REGISTRY.search_contacts.execute(ctx, {type:'foreign'});
// @ts-expect-error stage change requires an explicit stage
ACTION_REGISTRY.change_deal_stage.execute(ctx, {});
// @ts-expect-error normalized approval labels cannot be a string
ACTION_REGISTRY.assign_contact.execute(ctx, {_labels:'wrong'});`;
 const host=ts.createCompilerHost(parsed.options);const read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 host.readFile=p=>path.resolve(p)===virtual?source:read(p);host.fileExists=p=>path.resolve(p)===virtual||exists(p);
 const program=ts.createProgram([...parsed.fileNames,virtual],parsed.options,host);
 const diagnostics=ts.getPreEmitDiagnostics(program);
 assert.equal(diagnostics.length,0,ts.formatDiagnostics(diagnostics,{getCanonicalFileName:p=>p,getCurrentDirectory:()=>api,getNewLine:()=> '\n'}));
});
