#!/usr/bin/env bash
# CI only. Fresh, explicitly named database in verified GitHub service; no discovery or application startup.
set -euo pipefail
set +x
umask 077
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted && ${MM_PHASEC_DISPOSABLE:-} == YES ]] || exit 2
[[ $GITHUB_RUN_ID =~ ^[0-9]+$ && $GITHUB_RUN_ATTEMPT =~ ^[0-9]+$ && $MM_PHASEC_PG_PORT =~ ^[0-9]+$ ]] || exit 2
[[ $MM_PHASEC_CONTAINER_ID =~ ^[0-9a-f]{64}$ ]] || exit 2
python3 docs/phase-c-review/validation/concurrency.py --storage-only "$MM_PHASEC_CONTAINER_ID"
db="mm_phasecapp_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
[[ ${#db} -le 63 ]] || exit 2
pg(){ timeout 45 docker --context default exec -i "$MM_PHASEC_CONTAINER_ID" env -i PATH=/usr/local/bin:/usr/bin:/bin PGHOST=/var/run/postgresql PGPORT=5432 PGUSER=mm_phasec PGPASSWORD=phasec_dummy_only PGCONNECT_TIMEOUT=5 PGOPTIONS='-c statement_timeout=20000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=25000' psql -X -qAt -v ON_ERROR_STOP=1 -d "$1"; }
[[ $(printf "SELECT current_user||':'||current_database()||':'||current_setting('server_version_num')||':'||(inet_client_addr() IS NULL)::text;" | pg postgres) == mm_phasec:postgres:160015:true ]] || exit 2
[[ $(printf "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='%s');" "$db" | pg postgres) == f ]] || exit 2
created=0
cleanup(){ code=$?;trap - EXIT;if [[ $created == 1 ]];then printf 'DROP DATABASE "%s" WITH (FORCE);' "$db" | pg postgres >/dev/null 2>&1 || code=1;fi;exit "$code"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'CREATE DATABASE "%s" OWNER mm_phasec TEMPLATE template0;' "$db" | pg postgres >/dev/null
created=1
printf "COMMENT ON DATABASE \"%s\" IS 'MM_PHASEC_DISPOSABLE:%s:%s';" "$db" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" | pg postgres >/dev/null
[[ $(printf "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r';" | pg "$db") == 0 ]] || exit 2
export MM_PHASEC_APPLICATION_URL="postgresql://mm_phasec:phasec_dummy_only@127.0.0.1:${MM_PHASEC_PG_PORT}/$db"
export DATABASE_URL="$MM_PHASEC_APPLICATION_URL"
# Construct legacy schema only in runner temp; never rewrite repository schema or apply old partial migration history.
python3 - <<'PY'
import os,pathlib
s=pathlib.Path('apps/api/prisma/schema.prisma').read_text()
marker='// Phase C commercial foundation; SQL migration adds lifecycle/sealing invariants.'
assert s.count(marker)==1
legacy=s.split(marker)[0].replace('  commercialConversion QuotationInvoiceConversion?\n','').replace('  @@unique([businessId,id])\n','')
pathlib.Path(os.environ['RUNNER_TEMP'],'phasec-legacy.prisma').write_text(legacy)
PY
node apps/api/node_modules/prisma/build/index.js migrate diff --from-empty --to-schema-datamodel "$RUNNER_TEMP/phasec-legacy.prisma" --script > "$RUNNER_TEMP/phasec-legacy.sql"
pg "$db" < "$RUNNER_TEMP/phasec-legacy.sql" > /dev/null
pg "$db" < apps/api/prisma/migrations/20261010140000_quotation_foundation/migration.sql > /dev/null
pg "$db" < apps/api/prisma/migrations/20261010160000_quotation_customer_finance/migration.sql > /dev/null
node apps/api/node_modules/prisma/build/index.js generate --schema apps/api/prisma/schema.prisma > /dev/null
timeout --signal=TERM --kill-after=10 420 node --test --test-concurrency=1 apps/api/scripts/commercial-workflow-postgres.test.cjs
