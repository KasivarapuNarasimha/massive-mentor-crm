// Read-only probe. Return fixed aliases/codes and numeric metadata, never paths or messages.
const fs = require('node:fs');
const allowedCodes = new Set(['EACCES','EPERM','ENOENT','ENOTDIR','ELOOP','ENAMETOOLONG']);
const code = e => allowedCodes.has(e?.code) ? e.code : 'UNCLASSIFIED';
const targets = JSON.parse(process.argv[1]);
const result = {uid:process.getuid(),gid:process.getgid(),cwd:'UNVERIFIED',targets:[]};
try { process.cwd(); result.cwd='ACCESSIBLE'; } catch(e) { result.cwd=code(e); }
for(const t of targets) {
  const row={alias:t.alias,access:'UNVERIFIED',mode:null,ownerUid:null,ownerGid:null};
  try {
    const st=fs.statSync(t.path);
    row.mode=st.mode & 4095; row.ownerUid=st.uid; row.ownerGid=st.gid;
    fs.accessSync(t.path,t.mask);
    row.access='ACCESSIBLE';
  } catch(e) { row.access=code(e); }
  result.targets.push(row);
}
process.stdout.write(JSON.stringify(result));
