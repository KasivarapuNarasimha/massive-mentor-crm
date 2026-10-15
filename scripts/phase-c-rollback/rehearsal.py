#!/usr/bin/env python3
"""Offline artifact verification and disposable-only PM2 rollback. No production mode."""
import hashlib, json, os, pathlib, posixpath, re, shutil, subprocess, sys, tarfile, tempfile, time, urllib.request, urllib.error, zipfile

SOURCE = "a8a6edafa0a85c680625cedca24b9cd700d1af61"
CANDIDATE = "1bc44ba9d9a0951645df42a853bc5799650865ef"
ZIP_SHA = "647a76d633eb1cdc8ad1f1b57208d960489ff016810a0cd512b892595298f563"
TAR_SHA = "8d61dc51b6111a3ba34c5c46bed817020edfad692e3af8efd8430855da4fda26"
SCHEMA_SHA = "3d41158267407796e07be3f57eb50aa8cd034267e91b7ad5e1211f1287bfe14e"
REPO = "KasivarapuNarasimha/massive-mentor-crm"
ROOT_FILES = {"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "RELEASE.json",
              "apps/api/package.json", "apps/web/package.json"}
PREFIXES = ("node_modules/", "apps/api/dist/", "apps/api/prisma/", "apps/api/node_modules/",
            "apps/web/.next/", "apps/web/node_modules/", "apps/web/public/")

DIAGNOSTIC = {"phase": "ENTRY", "operation": "NONE", "exitCode": None, "postgres": "NOT_CHECKED", "pm2": "NOT_CHECKED"}

def phase(name):
    DIAGNOSTIC["phase"] = name

def failure_summary(error):
    # Only literal phases/statuses and numeric codes. Never exception messages,
    # command arguments, environment, response bodies, SQL, or subprocess logs.
    known = {"GateFailure", "KeyError", "TypeError", "ValueError", "JSONDecodeError", "PermissionError", "FileNotFoundError", "TimeoutExpired", "OSError"}
    kind = type(error).__name__
    return {**DIAGNOSTIC, "exceptionClass": kind if kind in known else "OtherException",
            "errno": error.errno if isinstance(error, OSError) and isinstance(error.errno, int) else None,
            "failure": safe_failure(error),
            "runtime": "FAILED", "productionAccess": False}


def safe_failure(error):
    value = str(error) if isinstance(error, GateFailure) else ""
    return value if value == "PM2_OPERATION" or re.fullmatch(r"[A-Z_]+",value) else "UNCLASSIFIED_FAILURE"

def pm2_error_categories(stdout, stderr):
    text=(stdout[:32768]+stderr[:32768]).decode("utf-8",errors="replace")
    signatures={"PERMISSION_DENIED":r"\b(?:EACCES|EPERM|Permission denied)\b",
                "CWD_UNAVAILABLE":r"uv_cwd|getcwd",
                "FILE_NOT_FOUND":r"\bENOENT\b|Script not found|Cannot find module",
                "ADDRESS_IN_USE":r"\bEADDRINUSE\b",
                "CONFIG_SYNTAX":r"SyntaxError|Malformed ecosystem|Unexpected token",
                "DAEMON_CONNECTION":r"connect (?:ECONNREFUSED|ETIMEDOUT)|Cannot connect to daemon"}
    return [name for name,pattern in signatures.items() if re.search(pattern,text)] or ["UNCLASSIFIED"]

def permission_probe(node, user, safeenv, root, active, pm2, config):
    # Same UID, clean environment, node binary and inherited cwd as the PM2 command.
    # No writes, socket connections, network probes or customer/config file reads.
    aliases = [
        ("RUNTIME_ROOT", root, 1), ("HOME", root/"home", 7),
        ("PM2_HOME",root/"pm2-home",7), ("LOG_DIRECTORY",root/"logs",7),
        ("NODE_BINARY",pathlib.Path(node),5), ("PM2_SCRIPT",pm2,4),
        ("ECOSYSTEM_CONFIG",config,4), ("API_CWD",active/"apps/api",5),
        ("WEB_CWD",active/"apps/web",5), ("API_ENTRY",active/"apps/api/dist/index.js",4),
        ("WEB_ENTRY",active/"apps/web/node_modules/next/dist/bin/next",4)]
    cwd=pathlib.Path.cwd()
    aliases.extend(("INHERITED_CWD" if i==0 else "CWD_PARENT_"+str(i),path,1)
                   for i,path in enumerate([cwd,*list(cwd.parents)[:6]]))
    targets=[{"alias":a,"path":str(p),"mask":mask} for a,p,mask in aliases]
    script=pathlib.Path(__file__).with_name("permission-probe.cjs").read_text()
    result=subprocess.run(["sudo","-u",user,"env","-i",*[k+"="+v for k,v in safeenv.items()],
                           node,"-e",script,json.dumps(targets)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
    if result.returncode: return {"probe":"FAILED","exitCode":result.returncode}
    data=json.loads(result.stdout[:32768])
    codes={"ACCESSIBLE","EACCES","EPERM","ENOENT","ENOTDIR","ELOOP","ENAMETOOLONG","UNCLASSIFIED"}
    permitted={a for a,_,_ in aliases}
    if (set(data)!={"uid","gid","cwd","targets"} or data["cwd"] not in codes
            or any(type(data[k]) is not int or data[k]<0 for k in ("uid","gid"))
            or type(data["targets"]) is not list or len(data["targets"])!=len(aliases)):
        return {"probe":"REJECTED"}
    for row in data["targets"]:
        if (set(row)!={"alias","access","mode","ownerUid","ownerGid"}
                or row["alias"] not in permitted or row["access"] not in codes
                or any(row[k] is not None and (type(row[k]) is not int or row[k]<0) for k in ("mode","ownerUid","ownerGid"))):
            return {"probe":"REJECTED"}
    return data

def cleanup_preserving_failure(action):
    primary=sys.exc_info()[1]
    saved=dict(DIAGNOSTIC)
    try:
        action()
    except BaseException as cleanup_error:
        if primary is None: raise
        saved["pythonCleanup"]="FAILED"
        saved["cleanupExceptionClass"]=type(cleanup_error).__name__ if type(cleanup_error).__name__ in {"TimeoutExpired","OSError","GateFailure"} else "OtherException"
    finally:
        if primary is not None:
            DIAGNOSTIC.clear(); DIAGNOSTIC.update(saved)

class GateFailure(Exception):
    pass

def require(ok, code):
    if not ok:
        raise GateFailure(code)

def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1048576), b""):
            h.update(block)
    return h.hexdigest()

def safe_name(name):
    require("\\" not in name and not name.startswith("/") and ":" not in name, "ARCHIVE_PATH")
    while name.startswith("./"):
        name = name[2:]
    p = pathlib.PurePosixPath(name)
    require(".." not in p.parts, "ARCHIVE_PARENT")
    require(not any(x.startswith(".env") or x in {".ssh", ".aws", "credentials", "id_rsa", "id_ed25519"} for x in p.parts), "ARCHIVE_SECRET_PATH")
    return p.as_posix()

def verify_bundle(archive, dest, source, expected_tar=None):
    require(not dest.exists(), "DESTINATION_EXISTS")
    if expected_tar:
        require(digest(archive) == expected_tar, "TAR_DIGEST")
    with tarfile.open(archive, "r:gz") as t:
        members = t.getmembers()
        seen = set()
        for m in members:
            n = safe_name(m.name)
            require(n not in seen, "DUPLICATE_TAR_ENTRY")
            seen.add(n)
            require(m.isdir() or m.isfile() or m.issym() or m.islnk(), "SPECIAL_TAR_ENTRY")
            if m.isdir():
                require(n == "." or n in {"apps", "apps/api", "apps/web"} or n.startswith(PREFIXES) or any(x.startswith(n + "/") for x in PREFIXES), "ARCHIVE_ALLOWLIST")
            else:
                require(n in ROOT_FILES or n.startswith(PREFIXES), "ARCHIVE_ALLOWLIST")
            if m.issym():
                require(not m.linkname.startswith("/") and "\\" not in m.linkname and ":" not in m.linkname, "SYMLINK_ABSOLUTE")
                target = posixpath.normpath(str(pathlib.PurePosixPath(n).parent / m.linkname))
                require(target != ".." and not target.startswith("../"), "SYMLINK_ESCAPE")
            if m.islnk():
                safe_name(m.linkname)
        raw = t.extractfile("./RELEASE.json") if "./RELEASE.json" in [m.name for m in members] else t.extractfile("RELEASE.json")
        manifest = json.load(raw)
        require(manifest["sourceCommit"] == source and manifest["platform"] == "linux-x64" and manifest["node"] == "v22.16.0", "BUNDLE_IDENTITY")
        require(manifest["schemaSha256"] == SCHEMA_SHA, "SCHEMA_IDENTITY")
        entries = manifest["files"]
        expected = {safe_name(e["path"]): e for e in entries}
        require(len(expected) == len(entries), "DUPLICATE_MANIFEST")
        require({safe_name(m.name) for m in members if not m.isdir()} == set(expected) | {"RELEASE.json"}, "MANIFEST_INVENTORY")
        dest.mkdir()
        t.extractall(dest, filter="data")
    for name, e in expected.items():
        p = dest / name
        require(p.resolve().is_relative_to(dest.resolve()), "LINK_ESCAPE")
        if "link" in e:
            require(p.is_symlink() and os.readlink(p) == e["link"] and p.exists(), "LINK_IDENTITY")
        else:
            require(p.is_file() and not p.is_symlink() and digest(p) == e["sha256"], "FILE_DIGEST")
    require(digest(dest / "apps/api/prisma/schema.prisma") == SCHEMA_SHA, "SCHEMA_DIGEST")
    return manifest

def unpack_candidate(zip_path, private):
    require(digest(zip_path) == ZIP_SHA, "ZIP_DIGEST")
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        tar = "massive-mentor-" + CANDIDATE + "-linux-x64.tar.gz"
        require(len(names) == 4 and set(names) == {tar, "RELEASE.json", "SHA256SUMS", "packaging-summary.txt"}, "ZIP_INVENTORY")
        require(z.testzip() is None, "ZIP_CRC")
        for n in names:
            require(not (z.getinfo(n).external_attr >> 16) & 0o170000 == 0o120000, "ZIP_SYMLINK")
            with z.open(n) as f, (private / n).open("xb") as out:
                shutil.copyfileobj(f, out)
        require((private / "SHA256SUMS").read_text().strip() == TAR_SHA + "  " + tar, "PUBLISHED_TAR_DIGEST")
        external = json.loads((private / "RELEASE.json").read_text())
    manifest = verify_bundle(private / tar, private / "candidate", CANDIDATE, TAR_SHA)
    require(manifest == external, "MANIFEST_DISAGREEMENT")
    return manifest

def compatibility(previous, candidate, before, after):
    for manifest in (before, after):
        require(all(k in manifest["safetySourceHashes"] for k in [
            "apps/api/src/services/restore-safety.ts",
            "apps/api/src/services/billing-access.service.ts",
            "apps/api/src/services/followup-engine.service.ts",
            "apps/api/src/services/strict-business-resolution.service.ts",
            "apps/api/prisma/migrations/20260907120000_import_batch/migration.sql"]), "SAFETY_SOURCE_INVENTORY")
    require(before["safetySourceHashes"] == after["safetySourceHashes"], "SAFETY_SOURCE_CHANGE")
    def migrations(root):
        return {str(p.relative_to(root)): digest(p) for p in (root / "apps/api/prisma/migrations").rglob("*") if p.is_file()}
    require(migrations(previous) == migrations(candidate), "MIGRATION_HISTORY_CHANGE")
    require(any("20260907120000_import_batch/migration.sql" in k for k in migrations(previous)), "IMPORT_BATCH_MISSING")
    for name in ["restore-safety", "billing-access.service", "followup-engine.service",
                 "strict-business-resolution.service", "commercial-finance.service",
                 "quotation-customer.service", "quotation.service", "lead-assignment-safety.service"]:
        p = "apps/api/dist/services/" + name + ".js"
        require((previous / p).is_file() and (candidate / p).is_file(), "SAFETY_RUNTIME_MISSING")
        require(digest(previous / p) == digest(candidate / p), "SAFETY_RUNTIME_CHANGE")
    for root in (previous, candidate):
        require("MM_SAFE_STARTUP" in (root / "apps/api/dist/index.js").read_text(), "STARTUP_CONTAINMENT_MISSING")

def run(args, env=None, timeout=60):
    # stdout/stderr are private; never surface raw errors or environment values.
    DIAGNOSTIC["operation"] = "ISOLATED_UID_LOOKUP"
    result = subprocess.run(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    DIAGNOSTIC["exitCode"] = result.returncode
    require(result.returncode == 0, "SUBPROCESS_FAILED")
    return result.stdout

def pg(sql):
    container = os.environ["MM_PHASEC_CONTAINER_ID"]
    db = "mm_phasecapp_" + os.environ["GITHUB_RUN_ID"] + "_" + os.environ["GITHUB_RUN_ATTEMPT"]
    require(re.fullmatch(r"[0-9a-f]{64}", container) and re.fullmatch(r"mm_phasecapp_[0-9]+_[0-9]+", db), "PG_TARGET")
    env = ["env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "PGHOST=/var/run/postgresql", "PGPORT=5432",
           "PGUSER=mm_phasec", "PGPASSWORD=phasec_dummy_only", "PGCONNECT_TIMEOUT=5",
           "PGOPTIONS=-c statement_timeout=20000 -c lock_timeout=5000"]
    DIAGNOSTIC["operation"] = "PG_READ_ONLY"
    result = subprocess.run(["docker", "--context", "default", "exec", "-i", container, *env,
                             "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", db],
                            input=sql.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
    DIAGNOSTIC["exitCode"] = result.returncode
    DIAGNOSTIC["postgres"] = "SELECT_OK" if result.returncode == 0 else "SELECT_FAILED"
    # SQLSTATE only, not server messages, statements, detail, or credentials.
    match = re.search(rb"(?:ERROR|FATAL):\s+([0-9A-Z]{5}):", result.stderr)
    if match: DIAGNOSTIC["sqlstate"] = match.group(1).decode("ascii")
    require(result.returncode == 0, "READ_ONLY_PG_CHECK")
    return result.stdout.decode().strip()

def fingerprint():
    marker = "MM_PHASEC_DISPOSABLE:" + os.environ["GITHUB_RUN_ID"] + ":" + os.environ["GITHUB_RUN_ATTEMPT"]
    identity = pg("SELECT current_database()||':'||current_user||':'||current_setting('server_version_num')||':'||shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();")
    db = "mm_phasecapp_" + os.environ["GITHUB_RUN_ID"] + "_" + os.environ["GITHUB_RUN_ATTEMPT"]
    require(identity == db + ":mm_phasec:160015:" + marker, "DATABASE_MARKER")
    tables = pg("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;").splitlines()
    result = {}
    for t in tables:
        require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", t), "TABLE_IDENTIFIER")
        data = pg('SELECT COALESCE(jsonb_agg(v ORDER BY v::text),\'[]\'::jsonb)::text FROM (SELECT to_jsonb(t) AS v FROM "' + t + '" t) s;')
        result[t] = hashlib.sha256(data.encode()).hexdigest()
    for t in ["User", "Business", "Contact", "Invoice", "Payment", "ImportBatch", "QuotationInvoiceConversion", "QuotationRevision", "QuotationEvent", "_prisma_migrations"]:
        require(t in result and int(pg('SELECT count(*) FROM "' + t + '";')) > 0, "POPULATED_FIXTURE_MISSING")
    catalog = pg("SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]'::jsonb)::text FROM (SELECT jsonb_build_object('table',c.relname,'constraint',k.conname,'definition',pg_get_constraintdef(k.oid)) AS v FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' UNION ALL SELECT jsonb_build_object('table',c.relname,'trigger',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal UNION ALL SELECT jsonb_build_object('function',p.proname,'definition',pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f') s;")
    result["_catalog"] = hashlib.sha256(catalog.encode()).hexdigest()
    return result

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def http(port, path):
    try:
        with urllib.request.build_opener(NoRedirect()).open("http://127.0.0.1:" + str(port) + path, timeout=3) as r:
            return r.status, r.read(1048576)
    except urllib.error.HTTPError as e:
        return e.code, e.read(1048576)

def runtime(private):
    require(sys.platform == "linux" and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted" and os.environ.get("MM_ROLLBACK_AUTHORIZED") == "YES", "EXECUTION_NOT_AUTHORIZED")
    require(os.environ.get("GITHUB_REPOSITORY") == REPO and re.fullmatch(r"[0-9]+", os.environ.get("GITHUB_RUN_ID", "")), "RUN_IDENTITY")
    root = pathlib.Path(os.environ["MM_ROLLBACK_ROOT"]).resolve()
    require(root.parent == pathlib.Path("/tmp") and root.name.startswith("mm-rollback-"), "RUNTIME_ROOT")
    previous, candidate = root / "previous", root / "candidate"
    require(previous.is_dir() and candidate.is_dir(), "VERIFIED_BUNDLES_REQUIRED")
    before = json.loads((previous / "RELEASE.json").read_text())
    after = json.loads((candidate / "RELEASE.json").read_text())
    phase("RUNTIME_BUNDLE_COMPATIBILITY")
    require(before["sourceCommit"] == SOURCE and after["sourceCommit"] == CANDIDATE, "RUNTIME_SOURCE")
    compatibility(previous, candidate, before, after)
    phase("BASELINE_FINGERPRINT")
    baseline = fingerprint()
    user = "mmrollback"
    uid = run(["id", "-u", user]).decode().strip()
    require(uid.isdigit(), "ISOLATED_UID")
    node = shutil.which("node")
    pm2 = root / "pm2/node_modules/pm2/bin/pm2"
    safeenv = {"PATH": str(pathlib.Path(node).parent) + ":/usr/bin:/bin", "HOME": str(root / "home"),
        "PM2_HOME": str(root / "pm2-home"), "NODE_ENV": "production", "MM_SAFE_STARTUP": "1",
        "DATABASE_URL": os.environ["MM_PHASEC_APPLICATION_URL"], "JWT_SECRET": os.urandom(48).hex(),
        "AI_PROVIDER": "groq", "GROQ_API_KEY": "synthetic-never-deliver-" + os.urandom(24).hex(),
        "MEDIA_STORAGE_DIR": str(root / "storage"), "BACKUP_DIR": str(root / "backups"),
        "FRONTEND_URL": "http://127.0.0.1:3000", "APP_URL": "http://127.0.0.1:3000",
        "CUSTOMER_APP_URL": "http://127.0.0.1:3000", "ADMIN_APP_URL": "http://127.0.0.1:3000",
        "COMMERCIAL_DELIVERY_KEY": os.urandom(32).hex(), "COMMERCIAL_PUBLIC_URL": "http://127.0.0.1:3000",
        "NEXT_TELEMETRY_DISABLED": "1"}
    # env -i prevents application .env/runner credentials reaching PM2. Bundles contain no .env.
    def pm(args, allow_failure=False):
        cmd = ["sudo", "-u", user, "env", "-i", *[k + "=" + v for k, v in safeenv.items()], node, str(pm2), *args]
        DIAGNOSTIC["operation"] = "PM2_" + args[0].upper()
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=35)
        DIAGNOSTIC["exitCode"] = result.returncode
        DIAGNOSTIC["pm2"] = "COMMAND_OK" if result.returncode == 0 else "COMMAND_FAILED"
        if result.returncode:
            DIAGNOSTIC["pm2ErrorCategories"]=pm2_error_categories(result.stdout,result.stderr)
        require(allow_failure or result.returncode == 0, "PM2_OPERATION")
        return result.stdout
    evidence = []
    active = root / "active"
    try:
        for label, bundle in [("before_upgrade", previous), ("after_upgrade", candidate), ("after_rollback", previous)]:
            phase(label.upper() + "_SWITCH")
            if active.is_symlink():
                pm(["kill"])
                stopped = subprocess.run(["ps", "-u", user, "-o", "pid="], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                require(stopped.returncode in (0, 1) and not stopped.stdout.strip(), "OLD_PROCESS_REMAINS")
            pending = root / "pending"
            pending.symlink_to(bundle, target_is_directory=True)
            os.replace(pending, active)
            # Copy the reviewed PM2 settings, changing only isolated paths/instance namespace.
            cfg = json.loads((private / "pm2-reviewed.json").read_text())
            require({a["name"] for a in cfg["apps"]} == {"massive-mentor-api", "massive-mentor-web"} and len(cfg["apps"]) == 2, "PM2_CONFIG")
            require(all(a["instances"] == 1 and a["exec_mode"] == "fork" for a in cfg["apps"]), "PM2_INSTANCES")
            for app in cfg["apps"]:
                app["cwd"] = str(active / "apps" / ("api" if app["name"] == "massive-mentor-api" else "web"))
                app["error_file"] = str(root / "logs" / (app["name"] + "-error.log"))
                app["out_file"] = str(root / "logs" / (app["name"] + "-out.log"))
            config = root / "ecosystem.config.cjs"
            config.write_text("module.exports=" + json.dumps(cfg) + ";\n")
            config.chmod(0o644)
            phase(label.upper() + "_PM2_START")
            try:
                DIAGNOSTIC["permissionBoundary"]=permission_probe(node,user,safeenv,root,active,pm2,config)
            except BaseException:
                DIAGNOSTIC["permissionBoundary"]={"probe":"UNAVAILABLE"}
            pm(["start", str(config), "--env", "production"])
            phase(label.upper() + "_HTTP_HEALTH")
            deadline = time.monotonic() + 75
            while True:
                try:
                    DIAGNOSTIC["operation"] = "HTTP_READY"
                    ready, body = http(4000, "/ready")
                    DIAGNOSTIC["readyStatus"] = ready
                    DIAGNOSTIC["operation"] = "HTTP_WEB_LOGIN"
                    web, _ = http(3000, "/login")
                    DIAGNOSTIC["webStatus"] = web
                    if ready == 200 and json.loads(body)["ready"] and web == 200:
                        break
                except (OSError, ValueError):
                    pass
                require(time.monotonic() < deadline, "HEALTH_TIMEOUT")
                time.sleep(1)
            require(http(4000, "/health")[0] == 200, "API_HEALTH")
            require(http(4000, "/api/quotations")[0] == 401, "STRICT_HTTP_AUTH_BOUNDARY")
            phase(label.upper() + "_PM2_INVENTORY")
            rows = json.loads(pm(["jlist"]))
            require(len(rows) == 2 and {r["name"] for r in rows} == {"massive-mentor-api", "massive-mentor-web"}, "PROCESS_INVENTORY")
            DIAGNOSTIC["processStatuses"] = [
                {"name": row.get("name") if row.get("name") in {"massive-mentor-api","massive-mentor-web"} else "UNEXPECTED",
                 "status": row.get("pm2_env",{}).get("status") if row.get("pm2_env",{}).get("status") in {"online","stopped","errored","launching","stopping"} else "UNKNOWN",
                 "restartCount": row.get("pm2_env",{}).get("restart_time") if isinstance(row.get("pm2_env",{}).get("restart_time"),int) else None}
                for row in rows]
            for r in rows:
                require(r["pid"] > 0 and r["pm2_env"]["status"] == "online" and r["pm2_env"]["restart_time"] == 0, "PROCESS_HEALTH")
                executable = pathlib.Path(r["pm2_env"]["pm_exec_path"]).resolve()
                require(executable.is_relative_to(bundle.resolve()), "PROCESS_ARTIFACT")
            phase(label.upper() + "_DATA_INTEGRITY")
            require(fingerprint() == baseline, "DATA_CHANGED")
            evidence.append({"stage": label, "health": "PASS", "processes": 2, "allPublicTableFingerprint": "UNCHANGED"})
    finally:
        cleanup_preserving_failure(lambda: pm(["kill"], allow_failure=True))
    require(fingerprint() == baseline, "FINAL_DATA_CHANGED")
    (private / "rollback-summary.json").write_text(json.dumps({
        "candidateSource": CANDIDATE, "fallbackSource": SOURCE,
        "fallbackIsPreviousProductionArtifact": False, "stages": evidence,
        "emailBrowser": "PENDING", "sameSnapshotSealingOrderings": "UNVERIFIED",
        "productionAccess": False}, indent=2) + "\n")

def main():
    command = sys.argv[1]
    private = pathlib.Path(os.environ.get("MM_ROLLBACK_PRIVATE", ".")).resolve()
    require(private.is_dir(), "PRIVATE_DIRECTORY")
    if command == "verify":
        root = pathlib.Path(os.environ["MM_ROLLBACK_ROOT"]).resolve()
        require(root.parent == pathlib.Path("/tmp") and root.name.startswith("mm-rollback-"), "RUNTIME_ROOT")
        manifest = unpack_candidate(pathlib.Path(sys.argv[2]), private)
        require(not (root / "candidate").exists(), "CANDIDATE_EXISTS")
        shutil.move(private / "candidate", root / "candidate")
        archive = pathlib.Path(sys.argv[3])
        fallback = verify_bundle(archive, root / "previous", SOURCE)
        compatibility(root / "previous", root / "candidate", fallback, manifest)
        (private / "artifact-summary.json").write_text(json.dumps({
            "candidateZipSha256": ZIP_SHA, "candidateTarSha256": TAR_SHA,
            "fallbackTarSha256": digest(archive), "candidateSource": CANDIDATE,
            "fallbackSource": SOURCE, "compatibilityStatic": "PASS",
            "runtimeCompatibility": "UNVERIFIED"}, indent=2) + "\n")
    elif command == "runtime":
        runtime(private)
    else:
        raise GateFailure("COMMAND_REJECTED")

if __name__ == "__main__":
    try:
        main()
    except BaseException as e:
        # Never upload traceback, raw subprocess output, tokens or credentials.
        safe = safe_failure(e)
        summary = failure_summary(e)
        # Write only to the already-created private directory; no path from error text.
        private = pathlib.Path(os.environ.get("MM_ROLLBACK_PRIVATE", ""))
        if private.is_dir() and private.name.startswith("mm-rollback-private-"):
            (private / "diagnostic-summary.json").write_text(json.dumps(summary,sort_keys=True)+"\n")
        print("MM_ROLLBACK_FAILURE:" + safe)
        print("MM_ROLLBACK_DIAGNOSTIC:" + json.dumps(summary,sort_keys=True))
        sys.exit(1)
