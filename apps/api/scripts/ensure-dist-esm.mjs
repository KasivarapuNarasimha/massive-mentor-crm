/**
 * Post-tsc guarantee for Node ESM (package "type": "module").
 *
 * TypeScript never rewrites extensionless relative imports to ".js" on emit —
 * even with module/moduleResolution NodeNext. It only typechecks; the specifier
 * in source is copied verbatim into dist.
 *
 * This script walks every .js file under apps/api/dist and:
 *  1. Rewrites relative import/export/dynamic-import specifiers to include ".js"
 *     (or "/index.js" when the target is a directory).
 *  2. Fails the build if any relative specifier still lacks a resolvable extension.
 *
 * Run: node scripts/ensure-dist-esm.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, "../dist");

if (!fs.existsSync(distRoot)) {
  console.error("[ensure-dist-esm] dist/ missing — run tsc first");
  process.exit(1);
}

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith(".js")) acc.push(p);
  }
  return acc;
}

function hasKnownExt(spec) {
  return (
    spec.endsWith(".js") ||
    spec.endsWith(".mjs") ||
    spec.endsWith(".cjs") ||
    spec.endsWith(".json") ||
    spec.endsWith(".node")
  );
}

/**
 * Resolve a relative specifier to a Node-loadable path with extension.
 * Prefer sibling .js; fall back to directory index.js.
 */
function resolveRelative(fromFile, spec) {
  if (!spec.startsWith(".")) return spec;
  if (hasKnownExt(spec)) return spec;

  // TypeScript emit sometimes keeps .ts if someone wrote .ts in source
  let base = spec;
  if (base.endsWith(".ts")) base = base.slice(0, -3);
  else if (base.endsWith(".tsx")) base = base.slice(0, -4);

  const fromDir = path.dirname(fromFile);
  const absNoExt = path.resolve(fromDir, base);
  const asFile = absNoExt + ".js";
  const asIndex = path.join(absNoExt, "index.js");

  if (fs.existsSync(asFile)) return base + ".js";
  if (fs.existsSync(asIndex)) {
    // preserve trailing structure with /index.js
    return base.replace(/\/?$/, "") + "/index.js";
  }

  // File not on disk yet (or path wrong) — still append .js so Node at least
  // looks for the conventional emit name (matches tsc outFile for .ts modules).
  return base + ".js";
}

// from '...', import('...'), side-effect import '...', export * from '...'
// Note: "from" covers `export { x } from` and `export * from`.
const importSpecRe =
  /(\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)(['"])(\.[^'"]+)\2/gm;

const files = walk(distRoot);
let filesChanged = 0;
let replacements = 0;
const remaining = [];

for (const file of files) {
  const orig = fs.readFileSync(file, "utf8");
  const next = orig.replace(importSpecRe, (full, prefix, quote, spec) => {
    const rewritten = resolveRelative(file, spec);
    if (rewritten !== spec) replacements += 1;
    return `${prefix}${quote}${rewritten}${quote}`;
  });

  if (next !== orig) {
    fs.writeFileSync(file, next, "utf8");
    filesChanged += 1;
  }

  // verify no extensionless relative specs remain
  let m;
  const verifyRe = /(\bfrom\s+|\bimport\s*\(\s*)(['"])(\.[^'"]+)\2/g;
  while ((m = verifyRe.exec(next !== orig ? next : orig))) {
    const s = m[3];
    if (!hasKnownExt(s)) {
      remaining.push(`${path.relative(distRoot, file)}: ${s}`);
    }
  }
}

// Hard requirement: dist/index.js must load env with .js
const indexPath = path.join(distRoot, "index.js");
if (!fs.existsSync(indexPath)) {
  console.error("[ensure-dist-esm] dist/index.js missing");
  process.exit(1);
}
const indexSrc = fs.readFileSync(indexPath, "utf8");
if (!/from\s+["']\.\/config\/env\.js["']/.test(indexSrc)) {
  // try to show what is there
  const hit = indexSrc.match(/from\s+["']\.\/config\/env[^"']*["']/);
  console.error(
    "[ensure-dist-esm] dist/index.js does not import ./config/env.js" +
      (hit ? ` (found ${hit[0]})` : " (no ./config/env import found)")
  );
  process.exit(1);
}

if (remaining.length) {
  console.error(
    `[ensure-dist-esm] ${remaining.length} extensionless relative import(s) remain:`
  );
  for (const line of remaining.slice(0, 40)) console.error("  " + line);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      scanned: files.length,
      filesChanged,
      replacements,
      envImport: "./config/env.js",
    },
    null,
    2
  )
);
