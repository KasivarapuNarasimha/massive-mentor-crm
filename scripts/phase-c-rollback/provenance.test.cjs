// Offline only: execute the real inline provenance script with mocked GitHub metadata.
const fs=require('node:fs'),assert=require('node:assert/strict'),test=require('node:test');
const text=fs.readFileSync('.github/workflows/phase-c-rollback-validation.yml','utf8').replace(/\r\n/g, '\n');
const body=text.split('          script: |\n')[1].split('  rollback:\n')[0].split('\n').map(l=>l.startsWith('            ')?l.slice(12):l).join('\n');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const fn=new AsyncFunction('process','github','context','core',body);
const sha='c97e6404562662205a92a4bcc43d037d93b8cc4f';
function fixture(){
 const env={GITHUB_REPOSITORY:'KasivarapuNarasimha/massive-mentor-crm',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_ACTOR:'KasivarapuNarasimha',GITHUB_WORKFLOW_REF:'KasivarapuNarasimha/massive-mentor-crm/.github/workflows/phase-c-rollback-validation.yml@refs/heads/main',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_ARCH:'X64',GITHUB_RUN_ID:'38556175565',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:sha,GITHUB_WORKFLOW_SHA:sha};
 const run={id:38556175565,run_attempt:1,repository:{full_name:env.GITHUB_REPOSITORY},event:'workflow_dispatch',head_branch:'main',head_sha:sha,status:'in_progress',actor:{login:'KasivarapuNarasimha'},triggering_actor:{login:'KasivarapuNarasimha'},run_started_at:new Date(Date.now()-10000).toISOString()};
 const workflow={path:'.github/workflows/phase-c-rollback-validation.yml'};
 const logs=[];const outputs=[];
 const execute=()=>fn({env},{rest:{actions:{getWorkflowRunAttempt:async()=>({data:run}),getWorkflow:async()=>({data:workflow})}}},{repo:{}},{error:x=>logs.push(x),setOutput:(...x)=>outputs.push(x)});
 return {env,run,workflow,logs,outputs,execute};
}
test('valid metadata proceeds without diagnostic disclosure',async()=>{const f=fixture();await f.execute();assert.equal(f.logs.length,0);assert.equal(f.outputs.length,1)});
for(const [id,change] of [
 ['RUN_ID',f=>f.run.id++],['RUN_ATTEMPT',f=>f.run.run_attempt++],
 ['REPOSITORY',f=>f.run.repository.full_name='secret-token'],
 ['EVENT',f=>f.run.event='secret-token'],['BRANCH',f=>f.run.head_branch='secret-token'],
 ['SOURCE_SHA',f=>f.env.GITHUB_SHA='secret-token'],['WORKFLOW_SHA',f=>f.env.GITHUB_WORKFLOW_SHA='secret-token'],
 ['RUN_STATUS',f=>f.run.status='queued'],['ACTOR',f=>f.run.actor.login='secret-token'],
 ['TRIGGERING_ACTOR',f=>f.run.triggering_actor.login='secret-token'],
 ['WORKFLOW_PATH',f=>f.workflow.path='secret-token'],['START_VALID',f=>f.run.run_started_at='secret-token'],
 ['START_NOT_FUTURE',f=>f.run.run_started_at=new Date(Date.now()+60000).toISOString()],
 ['START_MAX_AGE',f=>f.run.run_started_at=new Date(Date.now()-3600001).toISOString()]
]) test('fail closed and identify '+id,async()=>{
 const f=fixture();change(f);await assert.rejects(f.execute(),/Authenticated metadata rejected/);
 assert.equal(f.outputs.length,0);assert.equal(f.logs.length,1);assert.ok(f.logs[0].includes('"predicate":"'+id+'"'));
 assert.ok(!f.logs[0].includes('secret-token'));assert.ok(f.logs[0].length<2500);
});
test('completed post-run metadata is not historical proof',async()=>{const f=fixture();f.run.status='completed';await assert.rejects(f.execute());assert.ok(f.logs[0].includes('RUN_STATUS'))});
