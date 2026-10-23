#!/usr/bin/env bash
# Reviewed manual-only GitHub-hosted execution. No production mode.
set -euo pipefail
set +x
umask 077
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted && ${MM_ROLLBACK_AUTHORIZED:-} == YES ]] || exit 2
[[ ${GITHUB_REPOSITORY:-} == KasivarapuNarasimha/massive-mentor-crm ]] || exit 2
[[ $(git rev-parse HEAD) == 9219ba31f619bec15b563bbacf6ad82c5f80d3fc ]] || exit 2
[[ $GITHUB_RUN_ID =~ ^[0-9]+$ && $GITHUB_RUN_ATTEMPT =~ ^[0-9]+$ ]] || exit 2
[[ $MM_ROLLBACK_ROOT == /tmp/mm-rollback-* && -d $MM_ROLLBACK_ROOT && ! -L $MM_ROLLBACK_ROOT ]] || exit 2
[[ -d $MM_ROLLBACK_PRIVATE && -f $MM_ROLLBACK_PRIVATE/pm2-reviewed.json ]] || exit 2
tool=$(realpath "$(dirname "$0")")
[[ $(id -u) != 0 ]] || exit 2
! getent passwd mmrollback >/dev/null || exit 2
chain="MMRB${GITHUB_RUN_ID}${GITHUB_RUN_ATTEMPT}"
[[ ${#chain} -le 28 && $chain =~ ^MMRB[0-9]+$ ]] || exit 2
uid=0
created_user=0
v4=0
v6=0
cleanup() {
  primary_status=$?
  trap - EXIT INT TERM
  set +e
  cleanup_status=0
  process_status=NOT_CREATED
  safe_to_remove=1
  if [[ $created_user == 1 ]]; then
    (cd -- "$MM_ROLLBACK_ROOT" && timeout 35 sudo -u mmrollback env -i PATH="$PATH" HOME="$MM_ROLLBACK_ROOT/home" PM2_HOME="$MM_ROLLBACK_ROOT/pm2-home" node "$MM_ROLLBACK_ROOT/pm2/node_modules/pm2/bin/pm2" kill) > /dev/null 2>&1 || true
    owned=$(timeout 5 ps -u mmrollback -o pid= 2>/dev/null); ps_status=$?
    if [[ $ps_status -le 1 && -n $owned && $uid -gt 0 && $(id -u mmrollback) == "$uid" ]]; then
      timeout 5 sudo pkill -KILL -u "$uid" || true
      for n in 1 2 3 4 5; do
        owned=$(timeout 5 ps -u mmrollback -o pid= 2>/dev/null); ps_status=$?
        [[ $ps_status -le 1 && -z $owned ]] && break
        sleep 1
      done
    fi
    if [[ $ps_status -le 1 && -z $owned ]]; then process_status=VERIFIED_ABSENT
    else process_status=NOT_ESTABLISHED; cleanup_status=1; safe_to_remove=0; fi
  fi
  firewall4=NOT_CREATED
  firewall6=NOT_CREATED
  for family in 4 6; do
    active=$v4; command=iptables
    [[ $family == 6 ]] && active=$v6 && command=ip6tables
    outcome=NOT_CREATED
    if [[ $active == 1 ]]; then
      outcome=RETAINED
      if [[ $safe_to_remove == 1 ]]; then
        timeout 5 sudo "$command" -D OUTPUT -m owner --uid-owner "$uid" -j "$chain" || cleanup_status=1
        timeout 5 sudo "$command" -F "$chain" || cleanup_status=1
        timeout 5 sudo "$command" -X "$chain" || cleanup_status=1
        listing=$(timeout 5 sudo "$command" -S 2>/dev/null); list_status=$?
        if [[ $list_status == 0 && $listing != *"$chain"* ]]; then outcome=VERIFIED_ABSENT
        else outcome=NOT_ESTABLISHED; cleanup_status=1; fi
      fi
    fi
    [[ $family == 4 ]] && firewall4=$outcome || firewall6=$outcome
  done
  MM_CLEANUP_PRIMARY="$primary_status" MM_CLEANUP_RESULT="$cleanup_status" MM_CLEANUP_PROCESS="$process_status" MM_CLEANUP_V4="$firewall4" MM_CLEANUP_V6="$firewall6" python3 - <<'PYCLEAN'
import json,os,pathlib
p=pathlib.Path(os.environ['MM_ROLLBACK_PRIVATE'])
(p/'cleanup-summary.json').write_text(json.dumps({
 'primaryExitCode':int(os.environ['MM_CLEANUP_PRIMARY']),'cleanupExitCode':int(os.environ['MM_CLEANUP_RESULT']),
 'cleanupReached':True,'processes':os.environ['MM_CLEANUP_PROCESS'],
 'ipv4Firewall':os.environ['MM_CLEANUP_V4'],'ipv6Firewall':os.environ['MM_CLEANUP_V6'],
 'databaseCleanup':'SEE_SEPARATE_DATABASE_SUMMARY',
 'containerCleanup':'GITHUB_RUNNER_TEARDOWN','productionAccess':False})+'\n')
PYCLEAN
  [[ $? == 0 ]] || cleanup_status=1
  [[ $primary_status == 0 ]] || exit "$primary_status"
  exit "$cleanup_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
sudo useradd --system --no-create-home mmrollback
created_user=1
uid=$(id -u mmrollback)
[[ $uid =~ ^[0-9]+$ && $uid -gt 0 && $uid != "$(id -u)" ]] || exit 2
mkdir -p "$MM_ROLLBACK_ROOT"/{home,logs,storage,backups,pm2-home}
cp -a "$MM_ROLLBACK_PRIVATE/pm2-tool" "$MM_ROLLBACK_ROOT/pm2"
sudo chown -R "mmrollback:$(id -gn)" "$MM_ROLLBACK_ROOT"
sudo chmod -R g+rX "$MM_ROLLBACK_ROOT"
sudo chmod g+w "$MM_ROLLBACK_ROOT"
sudo -u mmrollback env -i PATH="$PATH" node --version | grep -qx 'v22.16.0'
sudo iptables -N "$chain"
v4=1
sudo iptables -A "$chain" -d 127.0.0.0/8 -j RETURN
sudo iptables -A "$chain" -j REJECT
sudo iptables -I OUTPUT 1 -m owner --uid-owner "$uid" -j "$chain"
sudo ip6tables -N "$chain"
v6=1
sudo ip6tables -A "$chain" -d ::1/128 -j RETURN
sudo ip6tables -A "$chain" -j REJECT
sudo ip6tables -I OUTPUT 1 -m owner --uid-owner "$uid" -j "$chain"
export MM_ROLLBACK_HELPER="$tool/rehearsal.py"
python3 - <<'PY'
import os,pathlib,hashlib
source=pathlib.Path('apps/api/scripts/commercial-application-run.sh').read_bytes()
assert hashlib.sha256(source).hexdigest() == 'f14eef3fbbc35b9a262105239658440e2be2fa190299b8eccda999a3cd2fea96'
text=source.decode()
last='timeout --signal=TERM --kill-after=10 420 node --test --test-concurrency=1 apps/api/scripts/commercial-workflow-postgres.test.cjs'
assert text.count(last)==1
# Copied cleanup is strengthened; fixed source script is unchanged.
old="if [[ $created == 1 ]];then printf"
new="""if [[ $created == 1 ]];then
expected="MM_PHASEC_DISPOSABLE:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}"
actual=$(printf "SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='%s';" "$db" | pg postgres) || exit 1
[[ $actual == "$expected" ]] || exit 1
printf"""
assert text.count(old)==1
text=text.replace(old,new)
cleanup_tail='|| code=1;fi;exit "$code"; }'
cleanup_evidence=r"""|| code=1;
remaining=$(printf "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='%s');" "$db" | pg postgres) || remaining=unknown
case "$remaining" in
 f) outcome=VERIFIED_ABSENT ;;
 t) outcome=STILL_PRESENT ;;
 *) outcome=UNVERIFIED ;;
esac
printf '{"databaseCleanup":"%s","productionAccess":false}\n' "$outcome" > "$MM_ROLLBACK_PRIVATE/database-cleanup-summary.json"
fi;exit "$code"; }"""
assert text.count(cleanup_tail)==1
text=text.replace(cleanup_tail,cleanup_evidence)
suffix=r'''
# Runtime-owned infrastructure is intentionally absent from the Prisma schema.
# Match the fixed application's PostgreSQL rate-limit store before safe startup.
printf 'CREATE TABLE rate_limit_buckets (key TEXT PRIMARY KEY,total_hits INTEGER NOT NULL DEFAULT 0,reset_time TIMESTAMPTZ NOT NULL); CREATE INDEX rate_limit_buckets_reset_idx ON rate_limit_buckets (reset_time);' | pg "$db" >/dev/null
printf 'INSERT INTO "ImportBatch" ("id","businessId","actorUserId","filename","createdCount","updatedCount","createdAt") VALUES ('\''phasec-rollback-import'\'','\''phasec-A'\'','\''phasec-owner'\'','\''synthetic.csv'\'',0,0,CURRENT_TIMESTAMP);' | pg "$db" >/dev/null
python3 - <<'PYSYNTH' > "$MM_ROLLBACK_PRIVATE/synthetic-ledger.sql"
import pathlib,hashlib,re,uuid
print('CREATE TABLE "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY,"checksum" VARCHAR(64) NOT NULL,"finished_at" TIMESTAMPTZ,"migration_name" VARCHAR(255) NOT NULL,"logs" TEXT,"rolled_back_at" TIMESTAMPTZ,"started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"applied_steps_count" INTEGER NOT NULL DEFAULT 0);')
for p in sorted(pathlib.Path('apps/api/prisma/migrations').glob('*/migration.sql')):
    name=p.parent.name
    assert re.fullmatch(r'[0-9]{14}_[a-zA-Z0-9_]+',name)
    checksum=hashlib.sha256(p.read_bytes()).hexdigest()
    ident=str(uuid.uuid5(uuid.NAMESPACE_URL,'synthetic:'+name))
    print('INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","finished_at","started_at","applied_steps_count") VALUES ('+"'"+ident+"','"+checksum+"','"+name+"',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1);")
PYSYNTH
pg "$db" < "$MM_ROLLBACK_PRIVATE/synthetic-ledger.sql" >/dev/null
python3 "$MM_ROLLBACK_HELPER" runtime
'''
text=text.replace(last,last+'\n'+suffix)
target=pathlib.Path(os.environ['RUNNER_TEMP'],'phasec-rollback-owned-db.sh')
assert not target.exists()
target.write_text(text)
PY
timeout --signal=TERM --kill-after=20 900 bash "$RUNNER_TEMP/phasec-rollback-owned-db.sh"
