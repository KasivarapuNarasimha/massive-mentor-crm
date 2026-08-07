#!/usr/bin/env node
/**
 * Massive Mentor CRM — production release gate.
 *
 * Runs every check required before deploy. Exits non-zero on first failure
 * so CI / deploy scripts can block releases.
 *
 * Usage (from monorepo root):
 *   pnpm production:verify
 *   node scripts/production-verify.mjs
 *   node scripts/production-verify.mjs --skip-tests   # lint/typecheck/build only
 *   node scripts/production-verify.mjs --skip-build
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const skipTests = args.has("--skip-tests");
const skipBuild = args.has("--skip-build");
const skipLint = args.has("--skip-lint");

const isWin = process.platform === "win32";

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

function nodeBin(label, binArgs, cwd) {
  return run(label, "node", binArgs, cwd);
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log(" Massive Mentor CRM — production:verify");
  console.log("═══════════════════════════════════════════════════");

  const steps = [];

  if (!skipLint) {
    steps.push(() => pnpm("lint", ["-r", "lint"]));
  }

  steps.push(() =>
    run(
      "typecheck:api",
      isWin ? "node_modules\\.bin\\tsc.CMD" : "node_modules/.bin/tsc",
      ["--noEmit", "-p", "tsconfig.json"],
      path.join(root, "apps/api")
    )
  );

  steps.push(() =>
    run(
      "typecheck:web",
      isWin ? "node_modules\\.bin\\tsc.CMD" : "node_modules/.bin/tsc",
      ["--noEmit", "-p", "tsconfig.json"],
      path.join(root, "apps/web")
    )
  );

  steps.push(() =>
    run(
      "prisma:validate",
      isWin ? "node" : "node",
      ["node_modules/prisma/build/index.js", "validate"],
      path.join(root, "apps/api")
    )
  );

  if (!skipBuild) {
    steps.push(() => pnpm("build", ["-r", "build"]));
  }

  if (!skipTests) {
    // Existing automated suites (optional if env not configured — still run and fail loud)
    steps.push(() =>
      nodeBin("test:rc", ["scripts/rc1-regression.mjs"]).catch((err) => {
        console.warn(
          "⚠ rc1-regression failed or needs live API — set API_URL/TEST credentials or use --skip-tests for offline gate"
        );
        throw err;
      })
    );
  }

  for (const step of steps) {
    await step();
  }

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
