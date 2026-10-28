// Self-contained disposable PostgreSQL only. No .env loading, app startup or migrations.
// Windows: node apps/api/scripts/commercial-sequence-postgres.test.cjs
// Optionally set MM_TEST_PG_BIN to a directory containing initdb/pg_ctl/psql.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
const localRequire = createRequire(path.resolve(__dirname,"../package.json"));
const { PrismaClient, Prisma } = localRequire("@prisma/client");
const ts = localRequire("typescript");
const bin = process.env.MM_TEST_PG_BIN || "C:/Program Files/PostgreSQL/17/bin";
const executable = name => path.join(bin, name + (process.platform === "win32" ? ".exe" : ""));
const cleanEnv = { ...process.env };
for (const key of Object.keys(cleanEnv)) if (/^PG|DATABASE_URL|DIRECT_URL/.test(key)) delete cleanEnv[key];
const run = (name, args) => execFileSync(executable(name), args, { env:cleanEnv, stdio: name === "pg_ctl" ? "ignore" : "pipe", windowsHide:true });
async function freePort() {
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const port=server.address().port; await new Promise(resolve=>server.close(resolve)); return port;
}
async function main() {
  if (!fs.existsSync(executable("initdb"))) throw Error("Disposable PostgreSQL binaries unavailable");
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"mm-commercial-pg-"));
  const data=path.join(directory,"data"); const port=await freePort();
  let started=false, db;
  try {
    run("initdb",["-D",data,"-U","mmtest","-A","trust","--no-locale","-E","UTF8"]);
    run("pg_ctl",["-D",data,"-l",path.join(directory,"postgres.log"),"-o",`-h 127.0.0.1 -p ${port}`,"-w","start"]);
    started=true;
    run("psql",["-h","127.0.0.1","-p",String(port),"-U","mmtest","-d","postgres","-v","ON_ERROR_STOP=1","-c","CREATE DATABASE mm_commercial_synthetic"]);
    db=new PrismaClient({datasources:{db:{url:`postgresql://mmtest@127.0.0.1:${port}/mm_commercial_synthetic?connection_limit=12`}}});
    // Minimal synthetic fixture table, not a project migration or schema push.
    await db.$executeRawUnsafe(`CREATE TABLE "InvoiceSequence" (
      "id" TEXT PRIMARY KEY, "key" TEXT NOT NULL UNIQUE, "prefix" TEXT NOT NULL,
      "lastValue" INTEGER NOT NULL DEFAULT 0, "businessId" TEXT,
      "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const file=path.resolve(__dirname,"../src/services/invoice-sequence.service.ts");
    const exports={};
    const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{exports,Date,require(id){if(id==="../lib/prisma.js")return {prisma:db};if(id==="@prisma/client")return {Prisma};throw Error("Unexpected dependency");}});
    const allocate=exports.nextFinanceInvoiceNumber;
    const year=new Date().getFullYear();
    const expected=n=>`INV-${year}-${String(n).padStart(5,"0")}`;
    const concurrent=await Promise.all(Array.from({length:20},()=>allocate("synthetic-A")));
    assert.equal(new Set(concurrent).size,20);
    assert.deepEqual(concurrent.slice().sort(),Array.from({length:20},(_,i)=>expected(i+1)));
    const tenant=await Promise.all([allocate("synthetic-A"),allocate("synthetic-B")]);
    assert.deepEqual(tenant,[expected(21),expected(1)]);
    await assert.rejects(db.$transaction(async tx=>{await allocate("synthetic-A",tx);throw Error("synthetic invoice failure");}),/synthetic invoice failure/);
    assert.equal(await allocate("synthetic-A"),expected(22));
    await assert.rejects(db.$transaction(async tx=>{await allocate("synthetic-rollback",tx);throw Error("rollback first creation");}),/rollback first creation/);
    assert.equal(await allocate("synthetic-rollback"),expected(1));
    // Prove an independent connection cannot acquire the held lock, then can after release.
    for(const rollback of [false,true]) {
      const key=`finance:synthetic-lock-${rollback}:${year}`;
      let signal; const ready=new Promise(resolve=>{signal=resolve;});
      let release; const gate=new Promise(resolve=>{release=resolve;});
      const owner=db.$transaction(async tx=>{
        await allocate(`synthetic-lock-${rollback}`,tx);signal();await gate;
        if(rollback)throw Error("release by rollback");
      },{timeout:10000});
      await ready;
      try {
        const held=await db.$transaction(tx=>tx.$queryRawUnsafe('SELECT pg_try_advisory_xact_lock(hashtext($1::text)) AS acquired',key));
        assert.equal(held[0].acquired,false);
      } finally {release();}
      if(rollback)await assert.rejects(owner,/release by rollback/);else await owner;
      const released=await db.$transaction(tx=>tx.$queryRawUnsafe('SELECT pg_try_advisory_xact_lock(hashtext($1::text)) AS acquired',key));
      assert.equal(released[0].acquired,true);
    }
    console.log("PASS: 20 concurrent allocations; tenant separation; outer rollback on existing/new sequence; lock held and released on commit/rollback. Real PostgreSQL, actual allocator.");
  } finally {
    if(db)await db.$disconnect();
    if(started)run("pg_ctl",["-D",data,"-m","fast","-w","stop"]);
    // Keep synthetic cluster/log files for review; no deletion of existing files.
    console.log((started ? "Disposable cluster stopped" : "Disposable cluster did not start") + "; synthetic fixture directory: " + directory);
  }
}
main().catch(error=>{console.error("FAIL:",error.message);process.exitCode=1;});
