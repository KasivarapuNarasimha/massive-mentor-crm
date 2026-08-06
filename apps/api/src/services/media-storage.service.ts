/**
 * Media file storage — local disk by default, S3-compatible ready.
 * Local path: {MEDIA_ROOT}/{businessId}/{assetId}__{safeName}
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { env } from "../config/env.js";

/** Maximum upload size per media file (enforced FE + BE + multer). */
export const MEDIA_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
export const MEDIA_MAX_MB = 25;

export const MEDIA_SIZE_LIMIT_MESSAGE =
  "File size exceeds the 25 MB limit. Please upload a smaller file.";

export function mediaRoot(): string {
  const fromEnv = (env as { MEDIA_DIR?: string }).MEDIA_DIR || process.env.MEDIA_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), "storage", "media");
}

export function maxMediaBytes(): number {
  return MEDIA_MAX_BYTES;
}

const ALLOWED: Record<string, string> = {
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "application/pdf": "pdf",
  "video/mp4": "video",
  "video/quicktime": "video",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "text/plain": "document",
};

export function kindFromMime(mime: string): string | null {
  const m = (mime || "").toLowerCase().split(";")[0]!.trim();
  return ALLOWED[m] || null;
}

export function isAllowedMime(mime: string): boolean {
  return !!kindFromMime(mime);
}

function safeFileName(name: string): string {
  return (name || "file")
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

export async function ensureMediaDir(businessId: string): Promise<string> {
  const dir = path.join(mediaRoot(), businessId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function saveMediaFile(opts: {
  businessId: string;
  assetId: string;
  originalName: string;
  buffer: Buffer;
}): Promise<{ storageKey: string; storageProvider: "local" }> {
  if (opts.buffer.length > MEDIA_MAX_BYTES) {
    throw new Error(MEDIA_SIZE_LIMIT_MESSAGE);
  }
  const dir = await ensureMediaDir(opts.businessId);
  const safe = safeFileName(opts.originalName);
  const storageKey = path.join(opts.businessId, `${opts.assetId}__${safe}`).replace(/\\/g, "/");
  const abs = path.join(mediaRoot(), storageKey);
  await fs.writeFile(abs, opts.buffer);
  return { storageKey, storageProvider: "local" };
}

export function absoluteMediaPath(storageKey: string): string {
  return path.join(mediaRoot(), storageKey);
}

export async function deleteMediaFile(storageKey: string): Promise<void> {
  const abs = absoluteMediaPath(storageKey);
  if (existsSync(abs)) {
    await fs.unlink(abs).catch(() => undefined);
  }
}

export function openMediaReadStream(storageKey: string) {
  const abs = absoluteMediaPath(storageKey);
  if (!existsSync(abs)) throw new Error("File not found on disk");
  return createReadStream(abs);
}

export async function readMediaBuffer(storageKey: string): Promise<Buffer> {
  const abs = absoluteMediaPath(storageKey);
  return fs.readFile(abs);
}
