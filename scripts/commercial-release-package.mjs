// Linux-only artifact preparation; no database connection or application startup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const run=(bin,args,options={})=>execFileSync(bin,args,{stdio:'pipe',timeout:180000,...options});
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
assert.equal(process.platform,'linux'); assert.equal(process.arch,'x64');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
const source=run('git',['rev-parse','HEAD']).toString().trim();
assert.match(source,/^[0-9a-f]{40}$/);
assert.equal(source,process.env.MM_RELEASE_SOURCE_COMMIT);
assert.equal(run('git',['status','--porcelain']).toString(),'');
const temp=fs.realpathSync(process.env.RUNNER_TEMP);
const root=fs.mkdtempSync(path.join(temp,'mm-release-'));
const bundle=path.join(root,'bundle'); fs.mkdirSync(bundle);
const copy=p=>{assert(fs.existsSync(p),`Required artifact absent: ${p}`);const target=path.join(bundle,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.cpSync(p,target,{recursive:true,dereference:false});};
// Explicit application allowlist: no .env, uploads, backup, storage or source tree.
for(const p of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','apps/api/package.json','apps/web/package.json','apps/api/dist','apps/api/prisma','apps/web/.next','apps/web/public']) copy(p);
fs.rmSync(path.join(bundle,'apps/web/.next/cache'),{recursive:true,force:true});
run('pnpm',['install','--prod','--offline','--frozen-lockfile','--ignore-scripts'],{cwd:bundle,timeout:300000});
run(process.execPath,['apps/api/node_modules/prisma/build/index.js','generate','--schema',path.join(bundle,'apps/api/prisma/schema.prisma')],{timeout:120000});
// Dependency and artifact symlinks must remain within the bundle.
const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name),rel=path.relative(bundle,p).split(path.sep).join('/');
 if(e.isSymbolicLink()){const resolved=fs.realpathSync(p);assert(resolved.startsWith(bundle+path.sep),`External artifact link: ${rel}`);files.push({path:rel,link:fs.readlinkSync(p)});}
 else if(e.isDirectory())walk(p);
 else {assert(!/^\.env(?:\.|$)/.test(e.name),`Environment file excluded: ${rel}`);files.push({path:rel,sha256:hash(p)});}
}}
walk(bundle); files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
const safety=['apps/api/src/services/restore-safety.ts','apps/api/src/services/billing-access.service.ts','apps/api/src/services/followup-engine.service.ts','apps/api/src/services/strict-business-resolution.service.ts','apps/api/prisma/migrations/20260907120000_import_batch/migration.sql'];
const manifest={sourceCommit:source,node:process.version,platform:'linux-x64',schemaSha256:hash('apps/api/prisma/schema.prisma'),safetySourceHashes:Object.fromEntries(safety.map(p=>[p,hash(p)])),files};
fs.writeFileSync(path.join(bundle,'RELEASE.json'),JSON.stringify(manifest,null,2)+'\n');
const out=path.resolve('release-evidence'); fs.mkdirSync(out,{recursive:true});
const artifact=path.join(out,`massive-mentor-${source}-linux-x64.tar.gz`);
// Stable tar metadata and gzip header. The checksum identifies this exact build.
const epoch=run('git',['show','-s','--format=%ct','HEAD']).toString().trim();assert.match(epoch,/^\d+$/);
run('tar',['--sort=name',`--mtime=@${epoch}`,'--owner=0','--group=0','--numeric-owner','-czf',artifact,'-C',bundle,'.'],{timeout:300000,env:{...process.env,GZIP:'-n'}});
fs.chmodSync(artifact,0o444);
fs.writeFileSync(path.join(out,'SHA256SUMS'),`${hash(artifact)}  ${path.basename(artifact)}\n`);
fs.copyFileSync(path.join(bundle,'RELEASE.json'),path.join(out,'RELEASE.json'));
// Scoped filesystem rollback rehearsal only; not prior-version or DB compatibility proof.
const rehearsal=path.join(root,'rollback');fs.mkdirSync(rehearsal);
const prior=path.join(rehearsal,'previous'),next=path.join(rehearsal,'next'),active=path.join(rehearsal,'active');
fs.mkdirSync(prior);fs.mkdirSync(next);
const preserved=['apps/api/prisma/schema.prisma',...safety,'apps/api/prisma/migrations/20261010140000_quotation_foundation/migration.sql','apps/api/prisma/migrations/20261010160000_quotation_customer_finance/migration.sql'];
for(const p of preserved){for(const d of [prior,next]){const target=path.join(d,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(p,target);}}
const before=Object.fromEntries(preserved.map(p=>[p,hash(path.join(prior,p))]));
fs.symlinkSync(prior,active,'dir');
const switchTo=target=>{assert([prior,next].includes(target));const pending=path.join(rehearsal,'pending');fs.symlinkSync(target,pending,'dir');fs.renameSync(pending,active);assert.equal(fs.realpathSync(active),target);};
switchTo(next); switchTo(prior);
for(const p of preserved)assert.equal(hash(path.join(active,p)),before[p]);
fs.writeFileSync(path.join(out,'packaging-summary.txt'),`Source: ${source}\nArtifact SHA256: ${hash(artifact)}\nLinux packaging: PASS\nIsolated atomic pointer switch/rollback: PASS\nImportBatch/history/safety preservation: PASS\nPrevious-production-artifact/PM2/database rollback rehearsal: UNVERIFIED\nReal SMTP/browser validation: PENDING\nSame-snapshot sealing lock orderings: UNVERIFIED (unreachable with committed-unsealed prohibition)\n`);
console.log(fs.readFileSync(path.join(out,'packaging-summary.txt'),'utf8'));
