/**
 * Rewrites TypeScript source imports for NodeNext ESM:
 * - @/foo/bar  -> relative path from file + .js
 * - ./foo      -> ./foo.js
 * - ../foo     -> ../foo.js
 * Leaves package imports untouched.
 *
 * Run from apps/api: node scripts/fix-esm-imports.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, "../src");

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function resolveAlias(fromFile, spec) {
  // @/foo/bar -> relative from fromFile to src/foo/bar
  const target = path.join(srcRoot, spec.slice(2));
  let rel = path.relative(path.dirname(fromFile), target);
  if (!rel.startsWith(".")) rel = "./" + rel;
  return toPosix(rel);
}

function ensureJsExt(spec) {
  if (!spec.startsWith(".")) return spec;
  if (
    spec.endsWith(".js") ||
    spec.endsWith(".json") ||
    spec.endsWith(".node") ||
    spec.endsWith(".mjs") ||
    spec.endsWith(".cjs")
  ) {
    return spec;
  }
  if (spec.endsWith(".ts")) return spec.slice(0, -3) + ".js";
  return spec + ".js";
}

function rewriteSpec(fromFile, spec) {
  let s = spec;
  if (s.startsWith("@/")) s = resolveAlias(fromFile, s);
  if (s.startsWith(".")) s = ensureJsExt(s);
  return s;
}

/**
 * Match:
 *   from '...'
 *   import('...')
 *   export ... from '...'
 */
const importSpecRe =
  /(\bfrom\s+|\bimport\s*\(\s*)(['"])([^'"]+)\2/g;

const files = walk(srcRoot);
let changedFiles = 0;
let replacements = 0;

for (const file of files) {
  const orig = fs.readFileSync(file, "utf8");
  const next = orig.replace(importSpecRe, (full, prefix, quote, spec) => {
    // skip type-only non-relative? still rewrite @/ and ./
    const rewritten = rewriteSpec(file, spec);
    if (rewritten !== spec) replacements += 1;
    return `${prefix}${quote}${rewritten}${quote}`;
  });

  if (next !== orig) {
    fs.writeFileSync(file, next, "utf8");
    changedFiles += 1;
  }
}

console.log(
  JSON.stringify(
    {
      scanned: files.length,
      changedFiles,
      replacements,
    },
    null,
    2
  )
);
