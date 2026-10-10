#!/usr/bin/env bash
# FUTURE CI ONLY: no discovery, startup, application env, or dependency installation.
# Explicit inputs: proposal argument; MM_PHASEC_CONTAINER_ID from CI service ID;
# independently approved MM_PHASEC_IMAGE_ID sha256 and MM_PHASEC_PROPOSAL_SHA256; MM_PHASEC_DISPOSABLE=YES.
# Also require MM_PHASEC_IMAGE_DIGEST and authenticated MM_PHASEC_RUN_STARTED_AT.
# Service contract: PG17, mm_phasec user, dummy password phasec_dummy_only, only a fresh Docker-created anonymous data volume.
set -euo pipefail
set +x
umask 077
here=$(cd -- "$(dirname -- "$0")" && pwd)
proposal=$1
[[ -f "$proposal" && "$(basename -- "$proposal")" == migration.sql.proposed ]] || exit 2
python3 - "$proposal" <<'PY'
import pathlib,re,sys
s=pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
if re.search(r"\bAS\s+\$(?!\$|[A-Za-z_])",s,re.I):
    sys.exit("FAIL: malformed SQL dollar delimiter; proposal review required")
if not s.startswith("-- REVIEW ONLY.") or len(re.findall(r"CREATE TABLE\s",s))!=8:
    sys.exit("FAIL: unexpected proposal")
PY
expected_hash=$MM_PHASEC_PROPOSAL_SHA256
[[ $expected_hash =~ ^[0-9a-f]{64}$ ]] || exit 2
actual_hash=$(sha256sum -- "$proposal" | cut -d' ' -f1)
[[ $actual_hash == "$expected_hash" ]] || { echo 'FAIL: proposal differs from approved hash'; exit 2; }
[[ $GITHUB_ACTIONS == true && $RUNNER_ENVIRONMENT == github-hosted && $MM_PHASEC_DISPOSABLE == YES ]] || exit 2
cid=$MM_PHASEC_CONTAINER_ID
image=$MM_PHASEC_IMAGE_ID
[[ $cid =~ ^[0-9a-f]{64}$ && $image =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2
[[ $GITHUB_RUN_ID =~ ^[0-9]+$ && $GITHUB_RUN_ATTEMPT =~ ^[0-9]+$ ]] || exit 2
db="mm_phasec_$GITHUB_RUN_ID""_$GITHUB_RUN_ATTEMPT"
[[ $(printf %s "$db" | wc -c) -le 63 ]] || exit 2
# Python checks creation-time provenance, digest, implicit volume and exclusive ownership.
# MM_PHASEC_RUN_STARTED_AT must come from authenticated CI run metadata.
timeout 120 python3 "$here/concurrency.py" --storage-only "$cid"
pg() {
 timeout 35 docker --context default exec -i "$cid" env -i PATH=/usr/local/bin:/usr/bin:/bin \
 PGHOST=/var/run/postgresql PGPORT=5432 PGUSER=mm_phasec PGPASSWORD=phasec_dummy_only \
 PGCONNECT_TIMEOUT=5 PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=4000 -c idle_in_transaction_session_timeout=25000' \
 psql -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d "$1"
}
identity=$(pg postgres <<'SQL'
SELECT current_user||':'||current_database()||':'||(current_setting('server_version_num')::int/10000)::text||':'||(inet_client_addr() IS NULL)::text;
SQL
)
[[ $identity == mm_phasec:postgres:17:true ]] || exit 2
exists=$(printf "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='%s');\n" "$db" | pg postgres)
[[ $exists == f ]] || { echo 'FAIL: disposable DB already exists'; exit 2; }
created=0
cleanup() {
 code=$?; trap - EXIT
 if [[ $created == 1 ]]; then
  if ! printf 'DROP DATABASE "%s" WITH (FORCE);\n' "$db" | pg postgres >/dev/null 2>&1; then
   echo 'FAIL: disposable cleanup failed'; code=1
  else echo 'Cleanup: only fresh run-specific database removed'; fi
 fi
 exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'CREATE DATABASE "%s" OWNER mm_phasec TEMPLATE template0;\n' "$db" | pg postgres >/dev/null
created=1
identity=$(printf "SELECT current_user||':'||current_database()||':'||(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database());\n" | pg "$db")
[[ $identity == "mm_phasec:$db:mm_phasec" ]] || exit 2
empty=$(pg "$db" <<'SQL'
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S');
SQL
)
[[ $empty == 0 ]] || exit 2
echo 'Preflight: isolated PostgreSQL 17 and empty run-specific database verified'
pg "$db" < "$proposal" >/dev/null
pg "$db" < "$here/catalog-and-negative.sql"
timeout 420 python3 "$here/concurrency.py" "$cid" "$db"
echo 'SQL suite complete; service authorization/hash/replay UNVERIFIED'
