// No subprocess, filesystem writes, database or network. Execute the actual probe with mocks.
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync('scripts/phase-c-rollback/permission-probe.cjs','utf8');
function probe(fail){
 let output='';
 vm.runInNewContext(source,{
  require:()=>({
   statSync:()=>({mode:0o40700,uid:123,gid:456}),
   accessSync:()=>{if(fail)throw {code:'EACCES',message:'secret',path:'/private/secret'};}
  }),
  process:{argv:['node',JSON.stringify([{alias:'PM2_HOME',path:'/private/secret',mask:7}])],
   getuid:()=>123,getgid:()=>456,cwd:()=>{if(fail)throw {code:'EACCES',message:'secret'};return '/private/secret'},
   stdout:{write:x=>output+=x}}
 });
 return {row:JSON.parse(output),output};
}
test('enabled UID read-only checks expose numeric metadata and aliases only',()=>{
 const {row,output}=probe(false);assert.equal(row.uid,123);assert.equal(row.cwd,'ACCESSIBLE');
 assert.equal(row.targets[0].access,'ACCESSIBLE');assert.ok(!output.includes('/private'));
});
test('denied inherited cwd/path retains EACCES without messages or paths',()=>{
 const {row,output}=probe(true);assert.equal(row.cwd,'EACCES');assert.equal(row.targets[0].access,'EACCES');
 assert.ok(!output.includes('secret'));assert.ok(!output.includes('/private'));
});
