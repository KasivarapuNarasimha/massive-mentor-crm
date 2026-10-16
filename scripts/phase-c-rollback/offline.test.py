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


    def pm_boundary(self):
        import ast
        source=pathlib.Path(r.__file__).read_text()
        fn=next(n for n in ast.walk(ast.parse(source)) if isinstance(n,ast.FunctionDef) and n.name=='pm')
        root=pathlib.Path('/tmp/mm-rollback-synthetic')
        namespace={**vars(r),'root':root,'user':'mmrollback','node':'/synthetic/node',
                   'pm2':root/'pm2/node_modules/pm2/bin/pm2','safeenv':{'MM_SAFE_STARTUP':'1'}}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'actual-pm-boundary','exec'),namespace)
        return namespace['pm'],root

    def test_pm_commands_use_private_cwd_and_retain_uid_clean_env_timeout(self):
        pm,root=self.pm_boundary()
        for args in [['start','synthetic-config','--env','production'],['jlist'],['delete','all'],['kill']]:
            with self.subTest(operation=args[0]), patch.object(r.subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'[]',b'')) as run:
                pm(args)
                command=run.call_args.args[0]
                self.assertEqual(command[:5],['sudo','-u','mmrollback','env','-i'])
                self.assertIn('MM_SAFE_STARTUP=1',command)
                self.assertEqual(run.call_args.kwargs['cwd'],root)
                self.assertEqual(run.call_args.kwargs['timeout'],35)

    def test_pm_failure_remains_fail_closed_after_cwd_change(self):
        pm,_=self.pm_boundary()
        with patch.object(r.subprocess,'run',return_value=subprocess.CompletedProcess([],1,b'',b'EACCES synthetic')):
            self.rejected('PM2_OPERATION',lambda:pm(['start','synthetic-config','--env','production']))
        self.assertEqual(r.DIAGNOSTIC['exitCode'],1)
        self.assertEqual(r.DIAGNOSTIC['pm2ErrorCategories'],['PERMISSION_DENIED'])

    def test_permission_probe_uses_same_private_cwd_without_disclosing_paths(self):
        root=pathlib.Path('/tmp/mm-rollback-synthetic')
        with patch.object(r.subprocess,'run',return_value=subprocess.CompletedProcess([],7,b'',b'SECRET')) as run:
            result=r.permission_probe('/synthetic/node','mmrollback',{'MM_SAFE_STARTUP':'1'},root,root/'active',root/'pm2-script',root/'config')
        self.assertEqual(run.call_args.kwargs['cwd'],root)
        self.assertEqual(run.call_args.kwargs['timeout'],10)
        self.assertEqual(run.call_args.args[0][:5],['sudo','-u','mmrollback','env','-i'])
        self.assertEqual(result,{'probe':'FAILED','exitCode':7})
        self.assertNotIn('SECRET',json.dumps(result))

    def test_cleanup_pm2_uses_scoped_subshell_cwd(self):
        text=pathlib.Path(__file__).with_name('run.sh').read_text()
        self.assertIn('(cd -- "$MM_ROLLBACK_ROOT" && timeout 35 sudo -u mmrollback env -i',text)
        self.assertIn('kill) > /dev/null 2>&1 || true',text)
        self.assertIn('[[ $primary_status == 0 ]] || exit "$primary_status"',text)

    def test_original_rollback_assertions_are_ast_identical(self):
        import ast
        tree=ast.parse(pathlib.Path(r.__file__).read_text())
        checks=[ast.dump(n) for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='require']
        self.assertEqual(hashlib.sha256('\n'.join(checks).encode()).hexdigest(),
                         'bb81503d5e4104bff79c13d1e12de8e0adf7e72c73bc885a3a5bf90f9b7da30c')

if __name__ == "__main__":
    unittest.main()
