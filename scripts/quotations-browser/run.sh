#!/usr/bin/env bash
# CI only. No application change, production credential, real recipient or external mail.
set -euo pipefail
set +x
umask 077
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted && ${MM_PHASEC_DISPOSABLE:-} == YES ]] || exit 2
[[ $GITHUB_RUN_ID =~ ^[0-9]+$ && $GITHUB_RUN_ATTEMPT =~ ^[0-9]+$ ]] || exit 2
[[ -n ${RUNNER_TEMP:-} && -d $RUNNER_TEMP && -n ${MM_BROWSER_SOURCE:-} ]] || exit 2
[[ $MM_BROWSER_SOURCE =~ ^[0-9a-f]{40}$ && $(git rev-parse HEAD) == "$MM_BROWSER_SOURCE" ]] || exit 2
export MM_BROWSER_TEMP
MM_BROWSER_TEMP=$(mktemp -d "$RUNNER_TEMP/mm-quotations-browser.XXXXXXXX")
readonly tag="mmq-browser-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
readonly uid=$(id -u)
rule_added=0
cert_added=0
cleanup(){
 primary=$?;trap - EXIT
 cleanup_code=0
 if [[ -f $MM_BROWSER_TEMP/process-ids ]];then
  while read -r pid;do
   [[ $pid =~ ^[0-9]+$ ]] || { cleanup_code=1;continue; }
   if kill -0 "$pid" 2>/dev/null;then
    kill -TERM -- "-$pid" 2>/dev/null || cleanup_code=1
    for n in {1..20};do kill -0 "$pid" 2>/dev/null || break;sleep .1;done
    if kill -0 "$pid" 2>/dev/null;then kill -KILL -- "-$pid" 2>/dev/null || cleanup_code=1;fi
   fi
  done < "$MM_BROWSER_TEMP/process-ids"
 fi
 if [[ $rule_added == 1 ]];then
  sudo -n iptables -t nat -D OUTPUT -o lo -d 127.0.0.1/32 -p tcp --dport 465 -m owner --uid-owner "$uid" -m comment --comment "$tag" -j REDIRECT --to-ports 2465 || cleanup_code=1
  rule_status=0
  sudo -n iptables -t nat -C OUTPUT -o lo -d 127.0.0.1/32 -p tcp --dport 465 -m owner --uid-owner "$uid" -m comment --comment "$tag" -j REDIRECT --to-ports 2465 2>/dev/null || rule_status=$?
  if [[ $rule_status == 1 ]];then echo MM_BROWSER_NETWORK_CLEANUP:VERIFIED_ABSENT;else cleanup_code=1;fi
 fi
 if [[ $cert_added == 1 ]];then certutil -D -d "sql:$HOME/.pki/nssdb" -n "$tag" || cleanup_code=1;fi
 mkdir -p evidence
 [[ ! -f $MM_BROWSER_TEMP/browser-summary.json ]] || cp -- "$MM_BROWSER_TEMP/browser-summary.json" evidence/browser-summary.json
 printf 'Primary exit: %s\nCleanup exit: %s\nOriginal same-snapshot lock orderings: UNVERIFIED\n' "$primary" "$cleanup_code" > evidence/browser-cleanup-summary.txt
 if [[ $primary != 0 ]];then exit "$primary";fi
 exit "$cleanup_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
command -v openssl >/dev/null
command -v certutil >/dev/null
# A generated one-run CA is trusted only in this disposable runner's browser store.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout "$MM_BROWSER_TEMP/ca.key" -out "$MM_BROWSER_TEMP/ca.crt" -subj /CN=MM-Disposable-Browser-CA >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -keyout "$MM_BROWSER_TEMP/server.key" -out "$MM_BROWSER_TEMP/server.csr" -subj /CN=127.0.0.1 >/dev/null 2>&1
printf 'subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\n' > "$MM_BROWSER_TEMP/server.ext"
openssl x509 -req -in "$MM_BROWSER_TEMP/server.csr" -CA "$MM_BROWSER_TEMP/ca.crt" -CAkey "$MM_BROWSER_TEMP/ca.key" -CAcreateserial -out "$MM_BROWSER_TEMP/server.crt" -days 1 -extfile "$MM_BROWSER_TEMP/server.ext" >/dev/null 2>&1
mkdir -p "$HOME/.pki/nssdb"
[[ -f $HOME/.pki/nssdb/cert9.db ]] || certutil -N --empty-password -d "sql:$HOME/.pki/nssdb"
certutil -A -d "sql:$HOME/.pki/nssdb" -n "$tag" -t 'C,,' -i "$MM_BROWSER_TEMP/ca.crt"
cert_added=1
# Keep the SMTP process unprivileged on 2465. Only this UID's loopback 465 is redirected.
if sudo -n iptables -t nat -C OUTPUT -o lo -d 127.0.0.1/32 -p tcp --dport 465 -m owner --uid-owner "$uid" -m comment --comment "$tag" -j REDIRECT --to-ports 2465 2>/dev/null;then exit 2;fi
sudo -n iptables -t nat -A OUTPUT -o lo -d 127.0.0.1/32 -p tcp --dport 465 -m owner --uid-owner "$uid" -m comment --comment "$tag" -j REDIRECT --to-ports 2465
rule_added=1
# Reuse every existing database/storage identity assertion and scoped DB cleanup unchanged.
python3 - <<'PY'
from pathlib import Path
import os
original=Path('apps/api/scripts/commercial-application-run.sh').read_text()
needle='timeout --signal=TERM --kill-after=10 420 node --test --test-concurrency=1 apps/api/scripts/commercial-workflow-postgres.test.cjs'
assert original.count(needle)==1
replacement='timeout --signal=TERM --kill-after=10 600 node scripts/quotations-browser/e2e.cjs'
Path(os.environ['MM_BROWSER_TEMP'],'application-browser-run.sh').write_text(original.replace(needle,replacement))
PY
bash "$MM_BROWSER_TEMP/application-browser-run.sh"
