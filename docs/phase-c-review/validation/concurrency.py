"""Future CI SQL-only tests. Standard library + docker/psql; no DB Python dependency.
No auth/hash/replay claims. Standalone invocation rechecks explicit disposable CI ID.
No endpoints are discovered; no app env is loaded; no server is started.
"""
import contextlib
import datetime
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import uuid

SAFE_ERRORS = {
    "COMMERCIAL_HISTORY_IMMUTABLE", "COMMERCIAL_SNAPSHOT_INCOMPLETE",
    "COMMERCIAL_SNAPSHOT_PRESEALED", "COMMERCIAL_CONTENT_INSERT_FORBIDDEN",
    "COMMERCIAL_SNAPSHOT_SEALED", "COMMERCIAL_SENT_SNAPSHOT_INVALID",
    "SENT_REVISION_IMMUTABLE", "COMMERCIAL_REVISION_RETAINED",
    "MM_PHASEC_SYNTHETIC_AUDIT_FAILURE",
}

def safe_error_class(state, message):
    if state == "P0001" and message in SAFE_ERRORS:
        return message
    m = re.search(r'(?:violates check constraint|violates unique constraint) "([A-Za-z0-9_]+)"', message)
    if state in ("23514", "23505") and m and m.group(1).startswith(("pc_", "Quotation")):
        return "constraint:" + m.group(1)
    if state == "22003" and message == "numeric field overflow":
        return "numeric_field_overflow"
    return "UNKNOWN"

class SqlFailure(Exception):
    def __init__(self, state, error_class):
        self.state = state
        self.error_class = error_class
        super().__init__("SQLSTATE " + state + " class " + error_class)

def check(ok, label):
    if not ok:
        raise AssertionError(label)

def docker_output(args):
    return subprocess.check_output(["docker", "--context", "default"] + args,
                                   text=True, stderr=subprocess.DEVNULL, timeout=5).strip()

def container_metadata(cid, field):
    return docker_output(["inspect", "--format", field, cid])

def timestamp(text):
    check(isinstance(text, str), "timestamp missing")
    # Docker RFC3339Nano -> datetime's microseconds, without floating point.
    value = datetime.datetime.fromisoformat(re.sub(r"(\.\d{6})\d+", r"\1", text).replace("Z", "+00:00"))
    check(value.tzinfo is not None, "timestamp timezone required")
    return value

def storage_preflight(cid):
    check(os.environ.get("GITHUB_ACTIONS") == "true", "CI required")
    check(os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted", "hosted runner required")
    check(os.environ.get("MM_PHASEC_DISPOSABLE") == "YES", "disposable attestation required")
    check(all(not os.environ.get(k) for k in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH")),
          "nondefault Docker endpoint forbidden")
    check(re.fullmatch(r"[0-9a-f]{64}", cid) is not None, "explicit full container ID")
    check(cid == os.environ.get("MM_PHASEC_CONTAINER_ID"), "container mismatch")
    check(docker_output(["context", "inspect", "default", "--format", "{{.Endpoints.docker.Host}}"] )
          == "unix:///var/run/docker.sock", "local hosted-runner Docker socket required")
    image_id = os.environ.get("MM_PHASEC_IMAGE_ID", "")
    digest = os.environ.get("MM_PHASEC_IMAGE_DIGEST", "")
    check(re.fullmatch(r"sha256:[0-9a-f]{64}", image_id) is not None, "approved image ID required")
    check(re.fullmatch(r"(?:docker.io/)?(?:library/)?postgres@sha256:[0-9a-f]{64}", digest) is not None,
          "approved official image digest required")
    check(container_metadata(cid, "{{.Id}}") == cid, "container identity")
    check(container_metadata(cid, "{{.Image}}") == image_id, "image ID mismatch")
    check(container_metadata(cid, "{{.Config.Image}}") == digest, "container not created from pinned digest")
    digests = json.loads(docker_output(["image", "inspect", "--format", "{{json .RepoDigests}}", image_id]))
    check(digest in (digests or []), "installed image digest mismatch")
    check(container_metadata(cid, "{{.State.Running}}") == "true", "running service")
    check(container_metadata(cid, "{{.RestartCount}}") == "0", "restarted/reused container forbidden")
    check(container_metadata(cid, "{{.HostConfig.NetworkMode}}") not in ("host", "none"), "private CI network required")
    started = timestamp(os.environ.get("MM_PHASEC_RUN_STARTED_AT", ""))
    created = timestamp(container_metadata(cid, "{{.Created}}"))
    now = datetime.datetime.now(datetime.timezone.utc)
    check(started <= created <= now + datetime.timedelta(seconds=2), "container predates CI run")
    check(now - started <= datetime.timedelta(hours=1), "stale CI run/container")
    # Docker-created VOLUME only: named/bind/volumes-from create requests forbidden.
    for field in ("Binds", "Mounts", "VolumesFrom"):
        check(not json.loads(container_metadata(cid, "{{json .HostConfig." + field + "}}")),
              "explicit or inherited storage forbidden")
    declarations = json.loads(container_metadata(cid, "{{json .Config.Volumes}}"))
    check(declarations == {"/var/lib/postgresql/data": {}}, "unexpected declared volumes")
    mounts = json.loads(container_metadata(cid, "{{json .Mounts}}"))
    check(len(mounts) == 1, "one implicit data volume required")
    mount = mounts[0]
    volume = mount.get("Name", "")
    check(mount.get("Type") == "volume" and mount.get("Driver") == "local" and
          mount.get("Destination") == "/var/lib/postgresql/data" and mount.get("RW") is True,
          "unsafe data mount")
    check(re.fullmatch(r"[0-9a-f]{64}", volume) is not None, "anonymous volume identity required")
    def vm(field):
        return docker_output(["volume", "inspect", "--format", field, volume])
    check(vm("{{.Name}}") == volume and vm("{{.Driver}}") == "local" and vm("{{.Scope}}") == "local",
          "external volume forbidden")
    check(not json.loads(vm("{{json .Options}}")), "volume driver options forbidden")
    labels = json.loads(vm("{{json .Labels}}")) or {}
    check(labels in ({}, {"com.docker.volume.anonymous": ""}), "nonanonymous volume labels")
    check(vm("{{.Mountpoint}}") == mount.get("Source"), "volume source mismatch")
    volume_created = timestamp(vm("{{.CreatedAt}}"))
    check(started <= volume_created and abs(created-volume_created) <= datetime.timedelta(seconds=10),
          "reused or ambiguously owned volume")
    consumers = docker_output(["ps", "--all", "--no-trunc", "--filter", "volume=" + volume,
                               "--format", "{{.ID}}"]).splitlines()
    check(consumers == [cid], "shared volume forbidden")
    # Trust boundary: CI must supply run_started_at from authenticated run metadata,
    # container ID from job.services, and approved immutable image values. Do not
    # derive these expected values from the inspected container itself.

def preflight(cid, db):
    storage_preflight(cid)
    check(re.fullmatch(r"mm_phasec_[0-9]+_[0-9]+", db) is not None, "database name")
    check(db == "mm_phasec_" + os.environ.get("GITHUB_RUN_ID", "") + "_" +
          os.environ.get("GITHUB_RUN_ATTEMPT", ""), "database/run mismatch")

class Session:
    def __init__(self, cid, db):
        self.proc = subprocess.Popen(
            ["docker", "--context", "default", "exec", "-i", cid, "env", "-i",
             "PATH=/usr/local/bin:/usr/bin:/bin", "PGHOST=/var/run/postgresql",
             "PGPORT=5432", "PGUSER=mm_phasec", "PGPASSWORD=phasec_dummy_only",
             "PGCONNECT_TIMEOUT=5",
             "PGOPTIONS=-c statement_timeout=10000 -c lock_timeout=4000 "
             "-c idle_in_transaction_session_timeout=25000",
             "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
             "-v", "VERBOSITY=verbose", "-d", db],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1)
        self.lines = queue.Queue()
        self.errors = []
        self.out_thread = threading.Thread(target=self._stdout, daemon=True)
        self.err_thread = threading.Thread(target=self._stderr, daemon=True)
        self.out_thread.start()
        self.err_thread.start()
        self.pending = None
        self.backend_pid = int(self.sql("SELECT pg_backend_pid();")[0])

    def _stdout(self):
        for line in self.proc.stdout:
            self.lines.put(line.rstrip("\r\n"))
        self.lines.put(None)

    def _stderr(self):
        for line in self.proc.stderr:
            # Keep only SQLSTATE/message class, never SQL text, DSNs or env dumps.
            m = re.search(r"ERROR:\s+([0-9A-Z]{5}):\s*(.*?)\s*$", line)
            if m:
                self.errors.append((m.group(1), safe_error_class(m.group(1), m.group(2))))

    def submit(self, sql):
        check(self.pending is None, "one pending command per connection")
        self.pending = "DONE_" + uuid.uuid4().hex
        self.proc.stdin.write(sql + "\n\\echo " + self.pending + "\n")
        self.proc.stdin.flush()

    def finish(self):
        check(self.pending is not None, "pending command required")
        deadline = time.monotonic() + 12
        out = []
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self.close()
                raise AssertionError("bounded SQL timeout")
            try:
                line = self.lines.get(timeout=remaining)
            except queue.Empty:
                self.close()
                raise AssertionError("bounded SQL timeout") from None
            if line is None:
                self.proc.wait(timeout=3)
                self.err_thread.join(timeout=3)
                self.pending = None
                raise SqlFailure(*(self.errors[-1] if self.errors else ("UNKNOWN", "UNKNOWN")))
            if line == self.pending:
                self.pending = None
                return [v for v in out if v]
            out.append(line)

    def sql(self, sql):
        self.submit(sql)
        return self.finish()

    def begin(self):
        return int(self.sql("BEGIN; SELECT pg_backend_pid();")[0])

    def close(self):
        if self.proc.poll() is None:
            with contextlib.suppress(BrokenPipeError, OSError):
                self.proc.stdin.write("ROLLBACK;\n\\q\n")
                self.proc.stdin.flush()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=3)
        for stream in (self.proc.stdin, self.proc.stdout, self.proc.stderr):
            with contextlib.suppress(OSError):
                stream.close()

@contextlib.contextmanager
def sessions(cid, db, count=3):
    group = []
    try:
        for _ in range(count):
            group.append(Session(cid, db))
        yield group
    finally:
        for s in group:
            s.close()

def rejection_result(s, operation, state, expected_class, observer, rollback_sql, expected_rows):
    try:
        operation()
    except SqlFailure as exc:
        check(exc.state == state and exc.error_class == expected_class,
              "unexpected negative-test error class")
        # ON_ERROR_STOP closes psql; prove its backend/transaction actually ended.
        deadline = time.monotonic() + 2
        gone = False
        while time.monotonic() < deadline:
            if observer.sql("SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=" +
                            str(s.backend_pid) + ");") == ["t"]:
                gone = True
                break
            time.sleep(0.02)
        check(gone, "failed transaction/backend not released")
        check(observer.sql(rollback_sql) == expected_rows, "negative-test rollback state mismatch")
        return
    raise AssertionError("negative SQL unexpectedly succeeded")

def rejected(s, sql, state, expected_class, observer, rollback_sql, expected_rows):
    rejection_result(s, lambda: s.sql(sql), state, expected_class,
                     observer, rollback_sql, expected_rows)

def reject_pending(s, state, expected_class, observer, rollback_sql, expected_rows):
    rejection_result(s, s.finish, state, expected_class, observer, rollback_sql, expected_rows)

def blocked(observer, waiter, owner):
    # Barrier = observed actual PostgreSQL blocking relation, never sleep-based ordering.
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if observer.sql(
                "SELECT " + str(owner) +
                "=ANY(pg_blocking_pids(" + str(waiter) + "));") == ["t"]:
            return
        time.sleep(0.02)
    raise AssertionError("expected blocking barrier not observed")

def quote(n):
    return (
        'INSERT INTO "Quotation"("id","businessId","number","creatorUserId",'
        '"ownerUserId","updatedAt") VALUES '
        f"('q{n}','A','synthetic-{n}','actor','actor',now());")

def revision(n, rid=None, number=1):
    rid = rid or "r" + n
    return (
        'INSERT INTO "QuotationRevision"("id","businessId","quotationId",'
        '"revisionNumber","contactId","timezone","currency","issueDate",'
        '"validUntil","terms","notes","updatedAt") VALUES '
        f"('{rid}','A','q{n}',{number},'synthetic','Asia/Kolkata','INR',"
        "'2030-01-01','2030-02-01','terms','',now());")

def snapshot(n, version=1, count=1, suffix="", sealed="NULL"):
    return (
        'INSERT INTO "QuotationPricingSnapshot"("id","businessId","revisionId",'
        '"revisionVersion","pricingVersion","policyVersion","policySnapshot",'
        '"customerSnapshot","canonicalInput","pricingOutput","contentHash",'
        '"hashVersion","expectedItemCount","sealedAt") VALUES '
        f"('s{n}{suffix}','A','r{n}',{version},'synthetic','synthetic','{{}}',"
        "'{}','{}','{}',repeat('a',64),'mm-commercial-content-v1',"
        f"{count},{sealed});")

def item(n, position=0, suffix=""):
    return (
        'INSERT INTO "QuotationRevisionItem"("id","businessId","snapshotId",'
        '"position","description","quantity","unitPrice","taxRate","discountInput",'
        '"calculation") VALUES '
        f"('i{n}{suffix}_{position}','A','s{n}{suffix}','{position}',"
        "'synthetic',1,10,0,'{}','{}');")

def seal(n, suffix=""):
    return f'UPDATE "QuotationPricingSnapshot" SET "sealedAt"=now() WHERE "id"=\'s{n}{suffix}\';'

def fixture(s, n):
    s.sql("BEGIN;" + quote(n) + revision(n) + snapshot(n) + item(n) + seal(n) +
          f'UPDATE "QuotationRevision" SET "currentSnapshotId"=\'s{n}\' WHERE "id"=\'r{n}\';'
          f'UPDATE "Quotation" SET "currentDraftRevisionId"=\'r{n}\' WHERE "id"=\'q{n}\'; COMMIT;')

def send(n, version=1):
    # Predicate example is a SQL test protocol, NOT the future service implementation.
    return (
        'UPDATE "QuotationRevision" SET "state"=\'sent\',"sentAt"=now() '
        f'WHERE "id"=\'r{n}\' AND "businessId"=\'A\' AND "version"={version} '
        'AND "state"=\'draft\' RETURNING "id";')

def edit(s, n):
    s.sql(f'UPDATE "QuotationRevision" SET "version"=2,"terms"=\'edited\' '
          f'WHERE "id"=\'r{n}\' AND "version"=1 AND "state"=\'draft\';')
    s.sql(snapshot(n, version=2, suffix="new") + item(n, suffix="new") + seal(n, "new") +
          f'UPDATE "QuotationRevision" SET "currentSnapshotId"=\'s{n}new\' WHERE "id"=\'r{n}\';')

def main(cid, db):
    preflight(cid, db)
    with sessions(cid, db, 1) as (s,):
        identity = s.sql("SELECT current_user||':'||current_database()||':'||"
                         "(current_setting('server_version_num')::int/10000)::text||':'||"
                         "(inet_client_addr() IS NULL)::text;")
        check(identity == [f"mm_phasec:{db}:17:true"], "DB identity")

    # COMMIT-time deferred validation; failed commit must leave no fixture.
    for n, action in (
        ("incomplete", "commit"),
        ("badcount", "seal"),
        ("badversion", "version"),
        ("presealed", "presealed"),
    ):
        with sessions(cid, db, 2) as (s, observer):
            s.sql("BEGIN;" + quote(n) + revision(n))
            if action == "presealed":
                rejected(s, snapshot(n, sealed="now()"), "P0001", "COMMERCIAL_SNAPSHOT_PRESEALED",
                         observer, f'SELECT count(*) FROM "Quotation" WHERE "id"=\'q{n}\';', ["0"])
            else:
                s.sql(snapshot(n, version=2 if action == "version" else 1))
                if action == "version":
                    s.sql(item(n))
                rejected(s, "COMMIT;" if action == "commit" else seal(n), "P0001",
                         "COMMERCIAL_SNAPSHOT_INCOMPLETE", observer,
                         f'SELECT count(*) FROM "Quotation" WHERE "id"=\'q{n}\';', ["0"])
            check(observer.sql(f'SELECT count(*) FROM "Quotation" WHERE "id"=\'q{n}\';') == ["0"],
                  "failed fixture rollback")
    print("PASS: incomplete commit, item count, revision version, presealed rejection")

    # Numeric/position checks must be exercised BEFORE sealing (otherwise insert
    # guard would mask the numeric check). Every failure rolls back its new fixture.
    for n, statement, state in (
        ("quantityzero", "quantity", "23514"),
        ("negativeprice", "price", "23514"),
        ("negativetax", "tax", "23514"),
        ("overflowprice", "overflow", "22003"),
        ("badposition", "position", "23514"),
        ("duplicateposition", "duplicate", "23505"),
    ):
        with sessions(cid, db, 2) as (s, observer):
            s.sql("BEGIN;" + quote(n) + revision(n) + snapshot(n))
            command = item(n)
            if statement == "quantity":
                command = command.replace("1,10,0,", "0,10,0,")
            elif statement == "price":
                command = command.replace("1,10,0,", "1,-1,0,")
            elif statement == "tax":
                command = command.replace("1,10,0,", "1,10,-1,")
            elif statement == "overflow":
                command = command.replace("1,10,0,", "1,10000000000000000,0,")
            elif statement == "position":
                command = command.replace("'0'", "'00'")
            else:
                s.sql(command)
                command = command.replace("'i" + n + "_0'", "'duplicate_item'")
            expected_class = {
                "quantity": "constraint:QuotationRevisionItem_quantity_check",
                "price": "constraint:QuotationRevisionItem_unitPrice_check",
                "tax": "constraint:QuotationRevisionItem_taxRate_check",
                "overflow": "numeric_field_overflow",
                "position": "constraint:QuotationRevisionItem_position_check",
                "duplicate": "constraint:pc_quotationrevisionitem_u1",
            }[statement]
            rejected(s, command, state, expected_class, observer,
                     'SELECT count(*) FROM "Quotation" WHERE "id"=\'q' + n + "';", ["0"])
            check(observer.sql('SELECT count(*) FROM "Quotation" WHERE "id"=\'q' + n + "';") == ["0"],
                  "invalid item whole transaction rollback")
    print("PASS: numeric bounds, position format/unique checks before sealing")

    # Both ordered send/edit races, barrier controlled on revision row.
    for first in ("send", "edit"):
        n = first + "race"
        with sessions(cid, db) as (a, b, observer):
            fixture(observer, n)
            pa, pb = a.begin(), b.begin()
            if first == "send":
                check(a.sql(send(n)) == ["r" + n], "send owner")
                b.submit('UPDATE "QuotationRevision" SET "version"=2 '
                         f'WHERE "id"=\'r{n}\' AND "version"=1 AND "state"=\'draft\' RETURNING "id";')
            else:
                edit(a, n)
                b.submit(send(n))
            blocked(observer, pb, pa)
            a.sql("COMMIT;")
            check(b.finish() == [], "stale concurrent predicate must change zero rows")
            b.sql("COMMIT;")
            row = observer.sql(f'SELECT "state"||\':\'||"version" FROM "QuotationRevision" WHERE "id"=\'r{n}\';')
            check(row == (["sent:1"] if first == "send" else ["draft:2"]), "race state")
    print("PASS: both send/edit orderings (SQL predicates only)")

    # Pointer replacement blocks behind quote owner and fails expected version.
    with sessions(cid, db) as (a, b, observer):
        n = "pointer"
        fixture(observer, n)
        observer.sql(revision(n, rid="rpointer2", number=2))
        pa, pb = a.begin(), b.begin()
        a.sql(f'SELECT "id" FROM "Quotation" WHERE "id"=\'q{n}\' FOR UPDATE;')
        a.sql(send(n))
        a.sql(f'UPDATE "Quotation" SET "effectiveSentRevisionId"=\'r{n}\',"version"=2 WHERE "id"=\'q{n}\';')
        b.submit(f'UPDATE "Quotation" SET "currentDraftRevisionId"=\'rpointer2\',"version"=2 '
                 f'WHERE "id"=\'q{n}\' AND "version"=1 RETURNING "id";')
        blocked(observer, pb, pa)
        a.sql("COMMIT;")
        check(b.finish() == [], "stale pointer replacement")
        b.sql("COMMIT;")
        check(observer.sql(f'SELECT "effectiveSentRevisionId" FROM "Quotation" WHERE "id"=\'q{n}\';')
              == ["rpointer"], "effective pointer retained")
    print("PASS: concurrent pointer replacement/send (SQL protocol only)")

    # MVCC limitation: no legal committed unsealed snapshot exists (deferred
    # completion rejects commit). An unsealed row is visible ONLY to its creator.
    # Therefore two independent transactions cannot both insert/seal the same
    # unsealed snapshot without disabling constraints or changing the proposal.
    # We intentionally do neither. The requested same-target lock orderings are
    # NOT PROVEN here. Test real competing operations' visibility/failure instead.
    for creator_action in ("items_first", "seal_first"):
        n = creator_action
        with sessions(cid, db) as (a, b, observer):
            observer.sql(quote(n) + revision(n))
            a.sql("BEGIN;" + snapshot(n) + item(n))
            if creator_action == "seal_first":
                a.sql(seal(n))
            b.sql("BEGIN;")
            # Actual UPDATE executes, but cannot see the creator's uncommitted row.
            check(b.sql(seal(n) + ' SELECT count(*) FROM "QuotationPricingSnapshot" '
                        f'WHERE "id"=\'s{n}\';') == ["0"], "uncommitted snapshot visibility")
            b.sql("ROLLBACK;")
            b.sql("BEGIN;")
            # Actual INSERT trigger, no manual pre-lock; missing visible parent fails.
            rejected(b, item(n, position=1), "P0001", "COMMERCIAL_CONTENT_INSERT_FORBIDDEN",
                     observer, f'SELECT count(*) FROM "QuotationRevisionItem" WHERE "id"=\'i{n}_1\';', ["0"])
            if creator_action == "items_first":
                a.sql(seal(n))
            a.sql("COMMIT;")
            check(observer.sql(f'SELECT "sealedAt" IS NOT NULL FROM "QuotationPricingSnapshot" WHERE "id"=\'s{n}\';')
                  == ["t"], "creator snapshot committed sealed")
            check(observer.sql(f'SELECT count(*) FROM "QuotationRevisionItem" WHERE "snapshotId"=\'s{n}\';')
                  == ["1"], "creator item set unchanged")
        with sessions(cid, db, 2) as (s, observer):
            s.sql("BEGIN;")
            rejected(s, item(n, position=1), "P0001", "COMMERCIAL_SNAPSHOT_SEALED", observer,
                     f'SELECT count(*) FROM "QuotationRevisionItem" WHERE "snapshotId"=\'s{n}\';', ["1"])
            # Bounded lock reacquisition confirms creator/failing writer locks released.
            observer.sql('BEGIN; SET LOCAL lock_timeout=\'500ms\'; '
                         f'SELECT "id" FROM "QuotationRevision" WHERE "id"=\'r{n}\' FOR UPDATE; '
                         f'SELECT "id" FROM "QuotationPricingSnapshot" WHERE "id"=\'s{n}\' FOR UPDATE; ROLLBACK;')
    print("PASS: actual INSERT/UPDATE visibility negatives, creator sealing, postseal rejection and lock release")
    print("UNVERIFIED: both same-target sealing/item trigger lock orderings cannot be constructed "
          "with independent transactions and an intact complete-at-commit invariant")

    # Same-tenant sequence serialization, independent tenant, rollback and lock release.
    allocation = ('INSERT INTO "QuotationSequence"("businessId","year","lastValue") '
                  "VALUES ('{tenant}',2030,1) ON CONFLICT (\"businessId\",\"year\") "
                  'DO UPDATE SET "lastValue"="QuotationSequence"."lastValue"+1 RETURNING "lastValue";')
    with sessions(cid, db) as (a, b, observer):
        pa, pb = a.begin(), b.begin()
        check(a.sql(allocation.format(tenant="seqA")) == ["1"], "first allocation")
        b.submit(allocation.format(tenant="seqA"))
        blocked(observer, pb, pa)
        check(observer.sql(allocation.format(tenant="seqB")) == ["1"], "tenant independent")
        a.sql("COMMIT;")
        check(b.finish() == ["2"], "serialized allocation")
        b.sql("COMMIT;")
        a.sql("BEGIN;")
        check(a.sql(allocation.format(tenant="seqA")) == ["3"], "rollback allocation")
        a.sql("ROLLBACK;")
        check(observer.sql(allocation.format(tenant="seqA")) == ["3"], "rollback lock release/value")
    print("PASS: sequence race, tenant separation, commit/rollback lock release")

    # Duplicate revision number blocks and fails 23505, no partial second revision.
    with sessions(cid, db) as (a, b, observer):
        n = "revisionrace"
        observer.sql(quote(n))
        pa, pb = a.begin(), b.begin()
        a.sql(revision(n, rid="race_r1"))
        b.submit(revision(n, rid="race_r2"))
        blocked(observer, pb, pa)
        a.sql("COMMIT;")
        reject_pending(b, "23505", "constraint:pc_quotationrevision_u3", observer,
                       'SELECT count(*) FROM "QuotationRevision" WHERE "id"=\'race_r2\';', ["0"])
        check(observer.sql('SELECT count(*) FROM "QuotationRevision" WHERE "quotationId"=\'qrevisionrace\';')
              == ["1"], "only one revision")
    print("PASS: duplicate revision-number race")

    # Uniqueness is tested; this is NOT service replay, 409 or canonical request proof.
    for same_hash in (True, False):
        key = "idem_same" if same_hash else "idem_different"
        def request(rid, digest, tenant="A"):
            return ('INSERT INTO "CommercialMutationRequest"("id","businessId","actorUserId",'
                    '"operation","key","requestHash","result") VALUES '
                    f"('{rid}','{tenant}','actor','synthetic','{key}',repeat('{digest}',64),'{{}}');")
        with sessions(cid, db) as (a, b, observer):
            pa, pb = a.begin(), b.begin()
            a.sql(request(key + "1", "a"))
            b.submit(request(key + "2", "a" if same_hash else "b"))
            blocked(observer, pb, pa)
            observer.sql(request(key + "B", "a", "B"))
            a.sql("COMMIT;")
            reject_pending(b, "23505", "constraint:pc_commercialmutationrequest_u1", observer,
                           f'SELECT count(*) FROM "CommercialMutationRequest" WHERE "id"=\'{key}2\';', ["0"])
            check(observer.sql(f'SELECT count(*) FROM "CommercialMutationRequest" WHERE "businessId"=\'A\' AND "key"=\'{key}\';')
                  == ["1"], "single committed result")
    print("PASS: same/different hash key conflicts and tenant independence; replay UNVERIFIED")

    # Critical audit failure surrogate: SQL exception must abort ALL synthetic writes.
    with sessions(cid, db, 2) as (s, observer):
        n = "auditrollback"
        s.sql("BEGIN;" + quote(n) + revision(n) + snapshot(n) + item(n) + seal(n))
        s.sql('INSERT INTO "QuotationSequence" VALUES (\'auditrollback\',2030,1);')
        s.sql('INSERT INTO "QuotationEvent"("id","businessId","snapshotId","actorUserId","event","metadata") '
              "VALUES ('auditrollback','A','sauditrollback','actor','synthetic','{}');")
        s.sql('INSERT INTO "CommercialMutationRequest"("id","businessId","actorUserId","operation","key","requestHash","result") '
              "VALUES ('auditrollback','A','actor','synthetic','auditrollback',repeat('a',64),'{}');")
        rejected(s, "DO $$ BEGIN RAISE EXCEPTION 'MM_PHASEC_SYNTHETIC_AUDIT_FAILURE'; END; $$;",
                 "P0001", "MM_PHASEC_SYNTHETIC_AUDIT_FAILURE", observer,
                 'SELECT count(*) FROM "Quotation" WHERE "id"=\'qauditrollback\';', ["0"])
        for table, condition in (
            ("Quotation", "\"id\"='qauditrollback'"),
            ("QuotationRevision", "\"id\"='rauditrollback'"),
            ("QuotationPricingSnapshot", "\"id\"='sauditrollback'"),
            ("QuotationRevisionItem", "\"snapshotId\"='sauditrollback'"),
            ("QuotationEvent", "\"id\"='auditrollback'"),
            ("CommercialMutationRequest", "\"id\"='auditrollback'"),
            ("QuotationSequence", "\"businessId\"='auditrollback'"),
        ):
            check(observer.sql(f'SELECT count(*) FROM "{table}" WHERE {condition};') == ["0"],
                  "audit failure whole transaction rollback")
    print("PASS: synthetic critical-audit exception rollback; actual audit integration UNVERIFIED")
    print("UNVERIFIED: service auth, grants, canonical hash/output, legal transitions, version "
          "regression, customer scope, billing, replay; SQL protocols are not service tests")

if __name__ == "__main__":
    try:
        check(len(sys.argv) == 3, "explicit container and disposable DB required")
        if sys.argv[1] == "--storage-only":
            storage_preflight(sys.argv[2])
            print("Storage preflight: fresh pinned service and exclusive anonymous volume verified")
        else:
            main(sys.argv[1], sys.argv[2])
    except (AssertionError, SqlFailure, OSError, ValueError, subprocess.SubprocessError) as exc:
        # Do not print subprocess command/environment or captured server output.
        print("FAIL: " + (str(exc) if isinstance(exc, (AssertionError, SqlFailure))
                          else type(exc).__name__), file=sys.stderr)
        sys.exit(1)
