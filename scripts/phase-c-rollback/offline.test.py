"""Offline negative tests only. Never starts processes, connects to PostgreSQL or downloads artifacts."""
import importlib.util, io, hashlib, json, pathlib, tarfile, tempfile, unittest, subprocess
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("rehearsal", pathlib.Path(__file__).with_name("rehearsal.py"))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

class StaticSafety(unittest.TestCase):
    def rejected(self, code, fn):
        with self.assertRaises(r.GateFailure) as e:
            fn()
        self.assertEqual(str(e.exception), code)

    def test_workflow_service_context_placement(self):
        import re
        workflow=pathlib.Path(__file__).parents[2]/'.github/workflows/phase-c-rollback-validation.yml'
        text=workflow.read_text()
        jobenv=text.split('    env:\n',1)[1].split('    steps:',1)[0]
        allowed=lambda value: re.search(r'\$\{\{\s*job\.',value) is None
        self.assertTrue(allowed(jobenv))
        self.assertFalse(allowed('MM_PHASEC_CONTAINER_ID: ${{ job.services.postgres.id }}'))
        self.assertIn('          MM_PHASEC_CONTAINER_ID: ${{ job.services.postgres.id }}',text)
        self.assertIn('          MM_PHASEC_PG_PORT: ${{ job.services.postgres.ports[5432] }}',text)

    def test_diagnostic_does_not_expose_exception_or_subprocess_arguments(self):
        r.phase("BASELINE_FINGERPRINT")
        for error in [KeyError("postgresql://secret"), PermissionError(13,"secret-token","/secret/path"),
                      subprocess.TimeoutExpired(["command","secret-password"],35,output=b"secret")]:
            summary=r.failure_summary(error)
            self.assertNotIn("secret",json.dumps(summary))
            self.assertEqual(summary["phase"],"BASELINE_FINGERPRINT")
            self.assertEqual(summary["runtime"],"FAILED")

    def test_command_failure_keeps_exit_code_and_assertion(self):
        with patch.object(r.subprocess,"run",return_value=subprocess.CompletedProcess([],7,b"",b"SECRET")):
            self.rejected("SUBPROCESS_FAILED",lambda:r.run(["id","-u","synthetic"]))
        self.assertEqual(r.DIAGNOSTIC["exitCode"],7)
        self.assertNotIn("SECRET",json.dumps(r.failure_summary(r.GateFailure("SUBPROCESS_FAILED"))))

    def test_gate_failure_remains_specific(self):
        self.assertEqual(r.failure_summary(r.GateFailure("DATA_CHANGED"))["failure"],"DATA_CHANGED")
        self.assertEqual(r.failure_summary(r.GateFailure("secret string"))["failure"],"UNCLASSIFIED_FAILURE")

    def test_pm2_literal_and_unexpected_codes(self):
        self.assertEqual(r.safe_failure(r.GateFailure("PM2_OPERATION")),"PM2_OPERATION")
        for value in ["PM2_OPERATION secret","PM2_OTHER123","TOKEN123","PM2_OPERATION\\nsecret"]:
            self.assertEqual(r.safe_failure(r.GateFailure(value)),"UNCLASSIFIED_FAILURE")

    def test_pm2_categories_are_bounded_and_redacted(self):
        self.assertEqual(r.pm2_error_categories(b"EACCES /secret password=token",b""),["PERMISSION_DENIED"])
        self.assertEqual(r.pm2_error_categories(b"x"*32768+b"EACCES",b""),["UNCLASSIFIED"])

    def test_cleanup_cannot_replace_primary_failure(self):
        def broken(): raise subprocess.TimeoutExpired(["secret"],35)
        try:
            raise r.GateFailure("PM2_OPERATION")
        except r.GateFailure as original:
            r.cleanup_preserving_failure(broken)
            self.assertEqual(r.safe_failure(original),"PM2_OPERATION")
            self.assertEqual(r.DIAGNOSTIC["pythonCleanup"],"FAILED")
        with self.assertRaises(subprocess.TimeoutExpired):
            r.cleanup_preserving_failure(broken)

    def test_path_rejections(self):
        for name, code in [("../x","ARCHIVE_PARENT"),("/x","ARCHIVE_PATH"),("C:x","ARCHIVE_PATH"),
                           ("x\\y","ARCHIVE_PATH"),("apps/api/.env","ARCHIVE_SECRET_PATH"),
                           ("node_modules/.ssh/key","ARCHIVE_SECRET_PATH")]:
            self.rejected(code, lambda: r.safe_name(name))
        self.assertEqual(r.safe_name("./apps/api/dist/index.js"), "apps/api/dist/index.js")

    def archive(self, root, extra=None, wrong_source=False, wrong_hash=False):
        schema=b"synthetic schema\n"
        r.SCHEMA_SHA=hashlib.sha256(schema).hexdigest()
        package=b"{}\n"
        entries=[{"path":"package.json","sha256":hashlib.sha256(package).hexdigest()},
                 {"path":"apps/api/prisma/schema.prisma","sha256":r.SCHEMA_SHA}]
        if wrong_hash: entries[0]["sha256"]="0"*64
        manifest={"sourceCommit": "0"*40 if wrong_source else r.SOURCE,
                  "platform":"linux-x64","node":"v22.16.0","schemaSha256":r.SCHEMA_SHA,"files":entries}
        p=root/"test.tar.gz"
        with tarfile.open(p,"w:gz") as t:
            for name,data in [("package.json",package),("apps/api/prisma/schema.prisma",schema),
                              ("RELEASE.json",json.dumps(manifest).encode())]:
                info=tarfile.TarInfo(name);info.size=len(data);t.addfile(info,io.BytesIO(data))
            if extra: t.addfile(extra)
        return p

    def test_minimal_manifest_positive(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)
            m=r.verify_bundle(self.archive(root),root/"out",r.SOURCE)
            self.assertEqual(m["sourceCommit"],r.SOURCE)

    def test_wrong_source(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)
            self.rejected("BUNDLE_IDENTITY",lambda:r.verify_bundle(self.archive(root,wrong_source=True),root/"out",r.SOURCE))

    def test_changed_file_digest(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)
            self.rejected("FILE_DIGEST",lambda:r.verify_bundle(self.archive(root,wrong_hash=True),root/"out",r.SOURCE))

    def test_escaping_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);extra=tarfile.TarInfo("apps/api/dist/link")
            extra.type=tarfile.SYMTYPE;extra.linkname="../../../../escape"
            self.rejected("SYMLINK_ESCAPE",lambda:r.verify_bundle(self.archive(root,extra),root/"out",r.SOURCE))

    def test_absolute_hardlink(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);extra=tarfile.TarInfo("apps/api/dist/link")
            extra.type=tarfile.LNKTYPE;extra.linkname="/etc/passwd"
            self.rejected("ARCHIVE_PATH",lambda:r.verify_bundle(self.archive(root,extra),root/"out",r.SOURCE))

    def test_special_file(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);extra=tarfile.TarInfo("apps/api/dist/device")
            extra.type=tarfile.CHRTYPE
            self.rejected("SPECIAL_TAR_ENTRY",lambda:r.verify_bundle(self.archive(root,extra),root/"out",r.SOURCE))

    def test_duplicate_entry(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);extra=tarfile.TarInfo("package.json")
            self.rejected("DUPLICATE_TAR_ENTRY",lambda:r.verify_bundle(self.archive(root,extra),root/"out",r.SOURCE))

if __name__ == "__main__":
    unittest.main()
