/**
 * Generate Massive Mentor CRM launcher + splash assets (brand blue #2563eb).
 * Pure Node PNG writer — no native image deps.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICON_DIR = path.join(ROOT, "resources", "icon");
const SPLASH_DIR = path.join(ROOT, "resources", "splash");
const ANDROID_RES = path.join(ROOT, "android", "app", "src", "main", "res");

fs.mkdirSync(ICON_DIR, { recursive: true });
fs.mkdirSync(SPLASH_DIR, { recursive: true });

const PRIMARY = [0x25, 0x63, 0xeb, 0xff]; // #2563eb
const WHITE = [0xff, 0xff, 0xff, 0xff];
const BG = [0xff, 0xff, 0xff, 0xff];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function writePng(file, width, height, rgbaFn) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = rgbaFn(x, y, width, height);
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

/** Rounded rect filled with brand blue + white "M" mark */
function iconRgba(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = w * 0.22;
  const inset = w * 0.08;
  // rounded square background
  const lx = Math.max(inset, Math.min(w - 1 - inset, x));
  const ly = Math.max(inset, Math.min(h - 1 - inset, y));
  const dx = Math.abs(x - cx) - (w / 2 - inset - radius);
  const dy = Math.abs(y - cy) - (h / 2 - inset - radius);
  const outside =
    x < inset ||
    y < inset ||
    x > w - 1 - inset ||
    y > h - 1 - inset ||
    (dx > 0 && dy > 0 && dx * dx + dy * dy > radius * radius);
  if (outside) return [0, 0, 0, 0];

  // Simple "M" glyph via strokes
  const nx = (x - cx) / (w * 0.28);
  const ny = (y - cy) / (h * 0.28);
  const inM =
    (nx > -0.85 && nx < -0.55 && ny > -0.75 && ny < 0.75) ||
    (nx > 0.55 && nx < 0.85 && ny > -0.75 && ny < 0.75) ||
    (Math.abs(nx) <= 0.55 && Math.abs(ny - (-0.75 + Math.abs(nx) * 1.35)) < 0.18 && ny < 0.1);
  if (inM) return WHITE;
  return PRIMARY;
}

function splashRgba(x, y, w, h) {
  // white canvas
  const s = Math.min(w, h);
  const iconSize = Math.floor(s * 0.28);
  const ox = Math.floor((w - iconSize) / 2);
  const oy = Math.floor((h - iconSize) / 2) - Math.floor(h * 0.04);
  if (x >= ox && x < ox + iconSize && y >= oy && y < oy + iconSize) {
    return iconRgba(x - ox, y - oy, iconSize, iconSize);
  }
  return BG;
}

const iconSizes = [48, 72, 96, 144, 192, 512];
for (const s of iconSizes) {
  writePng(path.join(ICON_DIR, `icon-${s}.png`), s, s, iconRgba);
}
writePng(path.join(ICON_DIR, "icon-1024.png"), 1024, 1024, iconRgba);
writePng(path.join(SPLASH_DIR, "splash-2732x2732.png"), 2732, 2732, splashRgba);
writePng(path.join(SPLASH_DIR, "splash-1372x1372.png"), 1372, 1372, splashRgba);

// Android density mapping
const androidMap = [
  ["mipmap-mdpi", 48],
  ["mipmap-hdpi", 72],
  ["mipmap-xhdpi", 96],
  ["mipmap-xxhdpi", 144],
  ["mipmap-xxxhdpi", 192],
];
for (const [folder, size] of androidMap) {
  const dir = path.join(ANDROID_RES, folder);
  if (!fs.existsSync(dir)) continue;
  const src = path.join(ICON_DIR, `icon-${size}.png`);
  fs.copyFileSync(src, path.join(dir, "ic_launcher.png"));
  fs.copyFileSync(src, path.join(dir, "ic_launcher_round.png"));
  fs.copyFileSync(src, path.join(dir, "ic_launcher_foreground.png"));
}

// Splash drawable
const drawable = path.join(ANDROID_RES, "drawable");
fs.mkdirSync(drawable, { recursive: true });
fs.copyFileSync(
  path.join(SPLASH_DIR, "splash-1372x1372.png"),
  path.join(drawable, "splash.png")
);

console.log("Brand assets generated:", { ICON_DIR, SPLASH_DIR });
