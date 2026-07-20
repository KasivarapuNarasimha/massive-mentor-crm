import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2] || "src";
const base = path.join(root, dir);

function walk(d, acc = []) {
  if (!fs.existsSync(d)) return acc;
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.(ts|js|mjs|cjs)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

const re = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
const bad = [];
for (const f of walk(base)) {
  const t = fs.readFileSync(f, "utf8");
  let m;
  while ((m = re.exec(t))) {
    const s = m[1];
    if (s.endsWith(".js") || s.endsWith(".json") || s.endsWith(".mjs") || s.endsWith(".cjs") || s.endsWith(".node")) {
      continue;
    }
    // allow type-only paths that end with nothing if it's a directory? still bad for ESM
    bad.push(`${path.relative(root, f)}: ${s}`);
  }
}
console.log(`scanned=${dir} extensionless=${bad.length}`);
for (const line of bad) console.log(line);
process.exit(bad.length ? 1 : 0);
