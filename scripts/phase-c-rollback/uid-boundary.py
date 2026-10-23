"""Exclusive UID allocation for one disposable runner. No production mode."""
import json, os, pathlib, re, subprocess, sys

def select_uid(accounts, processes, container_uid):
    used=set(accounts)|set(processes)|{0,container_uid}
    for value in range(20000,20128):
        if value not in used:return value
    raise RuntimeError("NO_EXCLUSIVE_UID")

def main():
    if os.environ.get("GITHUB_ACTIONS")!="true" or os.environ.get("RUNNER_ENVIRONMENT")!="github-hosted" or os.environ.get("MM_ROLLBACK_AUTHORIZED")!="YES":raise RuntimeError("DISPOSABLE_ONLY")
    container=os.environ["MM_PHASEC_CONTAINER_ID"]
    if not re.fullmatch(r"[0-9a-f]{64}",container):raise RuntimeError("CONTAINER_ID")
    def read(args):return subprocess.check_output(args,text=True,timeout=5).strip()
    pid=read(["docker","--context","default","inspect","--format","{{.State.Pid}}",container])
    if not pid.isdigit() or int(pid)<=0:raise RuntimeError("CONTAINER_PID")
    service_uid=int(read(["ps","-p",pid,"-o","uid="]))
    processes=[int(x) for x in read(["ps","-eo","uid="]).split()]
    accounts=[int(line.split(":")[2]) for line in read(["getent","passwd"]).splitlines()]
    uid=select_uid(accounts,processes,service_uid)
    private=pathlib.Path(os.environ["MM_ROLLBACK_PRIVATE"])
    if not private.is_dir() or not private.name.startswith("mm-rollback-private-"):raise RuntimeError("PRIVATE_DIRECTORY")
    record={"postgresServiceUid":service_uid,"postgresUidHostProcessCount":processes.count(service_uid),"isolatedUid":uid,"existingProcessCollision":False,"existingAccountCollision":False,"productionAccess":False}
    (private/"uid-boundary-summary.json").write_text(json.dumps(record)+"\n")
    print(uid)

if __name__=="__main__":main()
