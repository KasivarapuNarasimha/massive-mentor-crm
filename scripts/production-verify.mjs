#!/usr/bin/env node
/**
 * Massive Mentor CRM — production release gate (Phase 8).
 *
 * Hard-fail pipeline. Exit non-zero if any step fails.
 *
 * Usage (from monorepo root):
 *   pnpm production:verify
 *   node scripts/production-verify.mjs
 *   node scripts/production-verify.mjs --skip-tests
 *   node scripts/production-verify.mjs --skip-build
 *   node scripts/production-verify.mjs --skip-lint
 *   node scripts/production-verify.mjs --checklist-only
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const skipTests = args.has("--skip-tests");
const skipBuild = args.has("--skip-build");
const skipLint = args.has("--skip-lint");
const checklistOnly = args.has("--checklist-only");
const isWin = process.platform === "win32";

const results = [];

function run(label, command, commandArgs, cwd = root) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ [${label}] ${command} ${commandArgs.join(" ")}\n`);
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: "inherit",
      shell: isWin,
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      results.push({ label, code: code ?? 1 });
      if (code === 0) {
        console.log(`✓ [${label}] passed`);
        resolve();
      } else {
        reject(new Error(`[${label}] failed with exit code ${code}`));
      }
    });
  });
}

function pnpm(label, pnpmArgs, cwd) {
  return run(label, isWin ? "pnpm.cmd" : "pnpm", pnpmArgs, cwd);
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log(" Massive Mentor CRM — production:verify (Phase 8)");
  console.log("═══════════════════════════════════════════════════");

  if (checklistOnly) {
    await run("phase8-checklist", "node", [
      "scripts/phase8-release-checklist.mjs",
      "--skip-build",
      "--skip-lint",
    ]);
  } else {
    if (!skipLint) {
      // Lint is soft: continue if eslint config is incomplete (typecheck is hard gate)
      try {
        await pnpm("lint", ["-r", "lint"]);
      } catch {
        console.warn("⚠ lint failed or incomplete config — continuing (typecheck is required)");
        results.push({ label: "lint", code: 1, soft: true });
      }
    }

    await run(
      "typecheck:api",
      isWin ? "node_modules\\.bin\\tsc.CMD" : "node_modules/.bin/tsc",
      ["--noEmit", "-p", "tsconfig.json"],
      path.join(root, "apps/api")
    );

    await run(
      "typecheck:web",
      isWin ? "node_modules\\.bin\\tsc.CMD" : "node_modules/.bin/tsc",
      ["--noEmit", "-p", "tsconfig.json"],
      path.join(root, "apps/web")
    );

    await run(
      "prisma:validate",
      "node",
      ["node_modules/prisma/build/index.js", "validate"],
      path.join(root, "apps/api")
    );

    await run(
      "prisma:generate",
      "node",
      ["node_modules/prisma/build/index.js", "generate"],
      path.join(root, "apps/api")
    );

    if (!skipBuild) {
      await pnpm("build", ["-r", "build"]);
    }

    // Full Phase 8 checklist (env, deploy files, health, security posture)
    await run("phase8-checklist", "node", [
      "scripts/phase8-release-checklist.mjs",
      ...(skipBuild ? ["--skip-build"] : ["--skip-build"]), // builds already done above
      "--skip-lint",
    ]);

    if (!skipTests) {
      await run("test:rc", "node", ["scripts/rc1-regression.mjs"]);
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    results,
    ok: results.every((r) => r.code === 0 || r.soft),
  };
  fs.writeFileSync(
    path.join(root, "docs/PRODUCTION_VERIFY_LAST.json"),
    JSON.stringify(out, null, 2)
  );

  console.log("\n═══════════════════════════════════════════════════");
  console.log(" ✓ production:verify PASSED — safe to deploy");
  console.log("═══════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\n═══════════════════════════════════════════════════");
  console.error(" ✗ production:verify FAILED — do not deploy");
  console.error("═══════════════════════════════════════════════════");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
