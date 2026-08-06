/**
 * Media Library Phase 3 — Enterprise DAM:
 * AI recommendations, smart collections, versions, approval, expiry,
 * public share links, timeline, storage dashboard, NL search.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { recordAudit } from "./audit.service.js";
import { notifyUser } from "./notification.service.js";
import {
  canManageMedia,
  serializeAssetPublic,
  touchLastUsed,
  recordAssetEvent,
  getActorLabel,
  type SerializedMediaAsset,
} from "./media.service.js";
import {
  deleteMediaFile,
  openMediaReadStream,
  readMediaBuffer,
} from "./media-storage.service.js";

async function requireBusiness(userId: string): Promise<string> {
  const businessId = await getUserBusinessId(userId);
  if (!businessId) throw new Error("Workspace required for Media Library");
  return businessId;
}

export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function hashSharePassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifySharePassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = scryptSync(password, salt, 32).toString("hex");
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(check, "hex"));
  } catch {
    return false;
  }
}

/** Default workspace quota: 50 GB */
export function mediaQuotaBytes(): number {
  const fromEnv = Number(process.env.MEDIA_QUOTA_BYTES || "");
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 50 * 1024 * 1024 * 1024;
}

function formatStorage(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─── Shareable filter: approved + not archived + not expired + not deleted ───

export function shareableAssetWhere(businessId: string) {
  const now = new Date();
  return {
    businessId,
    deletedAt: null,
    archivedAt: null,
    approvalStatus: "approved",
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

// ─── Duplicate check ─────────────────────────────────────────────────────────

export async function findDuplicates(
  userId: string,
  opts: { contentHash?: string; originalName?: string; excludeAssetId?: string }
) {
  const businessId = await requireBusiness(userId);
  const or: Array<Record<string, unknown>> = [];
  if (opts.contentHash) or.push({ contentHash: opts.contentHash });
  if (opts.originalName?.trim()) {
    or.push({
      originalName: { equals: opts.originalName.trim(), mode: "insensitive" },
    });
    or.push({
      name: { equals: opts.originalName.trim(), mode: "insensitive" },
    });
  }
  if (!or.length) return [];

  const where: Record<string, unknown> = {
    businessId,
    deletedAt: null,
    isLatestVersion: true,
    OR: or,
  };
  if (opts.excludeAssetId) where.id = { not: opts.excludeAssetId };

  const hits = await prisma.mediaAsset.findMany({
    where: where as never,
    take: 10,
    orderBy: { createdAt: "desc" },
    include: { folder: { select: { id: true, name: true } } },
  });
  return hits.map((a) =>
    serializeAssetPublic(a, {
      folderName: a.folder?.name || null,
    })
  );
}

// ─── Smart collections (virtual dynamic folders) ─────────────────────────────

export type SmartCollectionKey =
  | "most_shared"
  | "recently_used"
  | "favorites"
  | "recently_uploaded"
  | "marketing"
  | "sales"
  | "videos"
  | "price_lists"
  | "pending_approval"
  | "archived"
  | "expiring_soon";

const COLLECTION_META: Array<{
  key: SmartCollectionKey;
  name: string;
  description: string;
  icon: string;
}> = [
  { key: "most_shared", name: "Most Shared", description: "Highest WhatsApp + email sends", icon: "📤" },
  { key: "recently_used", name: "Recently Used", description: "Touched in the last 30 days", icon: "🕐" },
  { key: "favorites", name: "Favorites", description: "Your starred files", icon: "⭐" },
  { key: "recently_uploaded", name: "Recently Uploaded", description: "Newest files first", icon: "🆕" },
  { key: "marketing", name: "Marketing", description: "Tags/folders: marketing, brochure, offer", icon: "📣" },
  { key: "sales", name: "Sales", description: "Tags/folders: sales, proposal, pitch", icon: "💼" },
  { key: "videos", name: "Videos", description: "All video assets", icon: "🎬" },
  { key: "price_lists", name: "Price Lists", description: "Pricing / rate cards", icon: "💰" },
  { key: "pending_approval", name: "Pending Approval", description: "Awaiting review", icon: "⏳" },
  { key: "archived", name: "Archived", description: "Expired or manually archived", icon: "📦" },
  { key: "expiring_soon", name: "Expiring Soon", description: "Expires within 14 days", icon: "⏰" },
];

export async function listSmartCollections(userId: string) {
  const businessId = await requireBusiness(userId);
  const base = { businessId, deletedAt: null as null };
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    mostShared,
    recentlyUsed,
    favCount,
    recentUp,
    videos,
    pending,
    archived,
    expiring,
  ] = await Promise.all([
    prisma.mediaAsset.count({
      where: { ...base, archivedAt: null, whatsappSendCount: { gt: 0 } },
    }),
    prisma.mediaAsset.count({
      where: { ...base, archivedAt: null, lastUsedAt: { gte: day30 } },
    }),
    prisma.mediaFavorite.count({ where: { businessId, userId } }),
    prisma.mediaAsset.count({
      where: {
        ...base,
        archivedAt: null,
        createdAt: { gte: day30 },
      },
    }),
    prisma.mediaAsset.count({ where: { ...base, archivedAt: null, kind: "video" } }),
    prisma.mediaAsset.count({
      where: { ...base, approvalStatus: "pending", archivedAt: null },
    }),
    prisma.mediaAsset.count({ where: { businessId, deletedAt: null, archivedAt: { not: null } } }),
    prisma.mediaAsset.count({
      where: {
        ...base,
        archivedAt: null,
        expiresAt: { gte: now, lte: in14 },
      },
    }),
  ]);

  // Tag/folder heuristic counts (approximate via search)
  const marketingFolders = await prisma.mediaFolder.findMany({
    where: {
      businessId,
      OR: [
        { name: { contains: "market", mode: "insensitive" } },
        { name: { contains: "brochure", mode: "insensitive" } },
        { name: { contains: "offer", mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  const salesFolders = await prisma.mediaFolder.findMany({
    where: {
      businessId,
      OR: [
        { name: { contains: "sales", mode: "insensitive" } },
        { name: { contains: "price", mode: "insensitive" } },
        { name: { contains: "crm", mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  const priceFolders = await prisma.mediaFolder.findMany({
    where: {
      businessId,
      OR: [
        { name: { contains: "price", mode: "insensitive" } },
        { name: { contains: "rate", mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });

  const [marketingCount, salesCount, priceCount] = await Promise.all([
    prisma.mediaAsset.count({
      where: {
        ...base,
        archivedAt: null,
        OR: [
          { tags: { hasSome: ["marketing", "brochure", "offer", "campaign"] } },
          ...(marketingFolders.length
            ? [{ folderId: { in: marketingFolders.map((f) => f.id) } }]
            : []),
        ],
      },
    }),
    prisma.mediaAsset.count({
      where: {
        ...base,
        archivedAt: null,
        OR: [
          { tags: { hasSome: ["sales", "proposal", "pitch", "demo"] } },
          ...(salesFolders.length
            ? [{ folderId: { in: salesFolders.map((f) => f.id) } }]
            : []),
        ],
      },
    }),
    prisma.mediaAsset.count({
      where: {
        ...base,
        archivedAt: null,
        OR: [
          { tags: { hasSome: ["pricing", "price", "pricelist", "rate-card"] } },
          { name: { contains: "price", mode: "insensitive" } },
          ...(priceFolders.length
            ? [{ folderId: { in: priceFolders.map((f) => f.id) } }]
            : []),
        ],
      },
    }),
  ]);

  const counts: Record<SmartCollectionKey, number> = {
    most_shared: mostShared,
    recently_used: recentlyUsed,
    favorites: favCount,
    recently_uploaded: recentUp,
    marketing: marketingCount,
    sales: salesCount,
    videos,
    price_lists: priceCount,
    pending_approval: pending,
    archived,
    expiring_soon: expiring,
  };

  return COLLECTION_META.map((c) => ({
    ...c,
    count: counts[c.key] ?? 0,
  }));
}

export async function listCollectionAssets(
  userId: string,
  collection: SmartCollectionKey,
  opts?: { page?: number; pageSize?: number }
) {
  const businessId = await requireBusiness(userId);
  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize || 48));
  const now = new Date();
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const in14 = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  let where: Record<string, unknown> = { businessId, deletedAt: null };
  let orderBy: Record<string, string> | Array<Record<string, string>> = {
    createdAt: "desc",
  };

  switch (collection) {
    case "most_shared":
      where = {
        ...where,
        archivedAt: null,
        OR: [{ whatsappSendCount: { gt: 0 } }, { emailSendCount: { gt: 0 } }],
      };
      orderBy = [{ whatsappSendCount: "desc" }, { emailSendCount: "desc" }];
      break;
    case "recently_used":
      where = { ...where, archivedAt: null, lastUsedAt: { gte: day30 } };
      orderBy = { lastUsedAt: "desc" };
      break;
    case "favorites": {
      const favIds = await prisma.mediaFavorite.findMany({
        where: { businessId, userId },
        select: { assetId: true },
      });
      if (!favIds.length) {
        return { items: [], total: 0, page, pageSize, totalPages: 1, collection };
      }
      where = { ...where, id: { in: favIds.map((f) => f.assetId) } };
      break;
    }
    case "recently_uploaded":
      where = { ...where, archivedAt: null };
      orderBy = { createdAt: "desc" };
      break;
    case "marketing": {
      const folders = await prisma.mediaFolder.findMany({
        where: {
          businessId,
          OR: [
            { name: { contains: "market", mode: "insensitive" } },
            { name: { contains: "brochure", mode: "insensitive" } },
            { name: { contains: "offer", mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      where = {
        ...where,
        archivedAt: null,
        OR: [
          { tags: { hasSome: ["marketing", "brochure", "offer", "campaign"] } },
          ...(folders.length ? [{ folderId: { in: folders.map((f) => f.id) } }] : []),
        ],
      };
      break;
    }
    case "sales": {
      const folders = await prisma.mediaFolder.findMany({
        where: {
          businessId,
          OR: [
            { name: { contains: "sales", mode: "insensitive" } },
            { name: { contains: "crm", mode: "insensitive" } },
            { name: { contains: "demo", mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      where = {
        ...where,
        archivedAt: null,
        OR: [
          { tags: { hasSome: ["sales", "proposal", "pitch", "demo"] } },
          ...(folders.length ? [{ folderId: { in: folders.map((f) => f.id) } }] : []),
        ],
      };
      break;
    }
    case "videos":
      where = { ...where, archivedAt: null, kind: "video" };
      break;
    case "price_lists": {
      const folders = await prisma.mediaFolder.findMany({
        where: {
          businessId,
          OR: [
            { name: { contains: "price", mode: "insensitive" } },
            { name: { contains: "rate", mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      where = {
        ...where,
        archivedAt: null,
        OR: [
          { tags: { hasSome: ["pricing", "price", "pricelist", "rate-card"] } },
          { name: { contains: "price", mode: "insensitive" } },
          ...(folders.length ? [{ folderId: { in: folders.map((f) => f.id) } }] : []),
        ],
      };
      break;
    }
    case "pending_approval":
      where = { ...where, approvalStatus: "pending", archivedAt: null };
      break;
    case "archived":
      where = { businessId, deletedAt: null, archivedAt: { not: null } };
      orderBy = { archivedAt: "desc" };
      break;
    case "expiring_soon":
      where = {
        ...where,
        archivedAt: null,
        expiresAt: { gte: now, lte: in14 },
      };
      orderBy = { expiresAt: "asc" };
      break;
    default:
      throw new Error("Unknown collection");
  }

  const [total, assets, favRows] = await Promise.all([
    prisma.mediaAsset.count({ where: where as never }),
    prisma.mediaAsset.findMany({
      where: where as never,
      orderBy: orderBy as never,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { folder: { select: { id: true, name: true } } },
    }),
    prisma.mediaFavorite.findMany({
      where: { userId, businessId },
      select: { assetId: true },
    }),
  ]);
  const favSet = new Set(favRows.map((f) => f.assetId));

  return {
    collection,
    items: assets.map((a) =>
      serializeAssetPublic(a, {
        isFavorite: favSet.has(a.id),
        folderName: a.folder?.name || null,
      })
    ),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ─── AI file recommendations for a lead/client ───────────────────────────────

export async function recommendFilesForContact(userId: string, contactId: string) {
  const businessId = await requireBusiness(userId);
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      deletedAt: null,
      OR: [{ businessId }, { userId }],
    },
  });
  if (!contact) throw new Error("Lead/Client not found");

  const dealRows = await prisma.deal.findMany({
    where: {
      contactId,
      OR: [{ businessId }, { userId }],
    },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { stage: true, title: true },
  });

  const serviceHints: string[] = [];
  // customFields may hold interested services
  const cf = (contact.customFields || {}) as Record<string, unknown>;
  for (const key of [
    "interestedIn",
    "interested_in",
    "service",
    "services",
    "product",
    "products",
    "requirement",
  ]) {
    const v = cf[key];
    if (typeof v === "string" && v.trim()) serviceHints.push(v.trim());
    if (Array.isArray(v)) {
      for (const x of v) if (typeof x === "string" && x.trim()) serviceHints.push(x.trim());
    }
  }
  if (contact.description) {
    // Pull short tokens from description
    const words = contact.description
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
      .slice(0, 12);
    serviceHints.push(...words);
  }

  const industry = (contact.industry || "").trim();
  const tags = contact.tags || [];
  const stages = dealRows.map((d) => d.stage);
  const stageKeywords: string[] = [];
  for (const s of stages) {
    if (/propos|quot|negotiat/i.test(s)) stageKeywords.push("pricing", "proposal", "brochure", "price");
    else if (/qualified|contact/i.test(s)) stageKeywords.push("brochure", "company", "profile", "demo");
    else if (/won|closed/i.test(s)) stageKeywords.push("onboarding", "welcome", "contract");
    else stageKeywords.push("brochure", "intro", "company");
  }

  const tokens = [
    ...serviceHints,
    industry,
    ...tags,
    ...stageKeywords,
    ...dealRows.map((d) => d.title),
  ]
    .filter(Boolean)
    .map((t) => t.toLowerCase())
    .flatMap((t) => t.split(/[^a-z0-9]+/).filter((w) => w.length > 2));

  const uniqueTokens = [...new Set(tokens)].slice(0, 40);

  const shareable = shareableAssetWhere(businessId);
  const assets = await prisma.mediaAsset.findMany({
    where: shareable as never,
    take: 200,
    orderBy: [{ whatsappSendCount: "desc" }, { downloadCount: "desc" }],
    include: { folder: { select: { id: true, name: true } } },
  });

  type Scored = { asset: (typeof assets)[0]; score: number; reasons: string[] };
  const scored: Scored[] = [];

  for (const a of assets) {
    let score = 0;
    const reasons: string[] = [];
    const hay = [
      a.name,
      a.originalName,
      ...(a.tags || []),
      a.folder?.name || "",
      a.captionDefault || "",
      a.kind,
    ]
      .join(" ")
      .toLowerCase();

    for (const t of uniqueTokens) {
      if (hay.includes(t)) {
        score += t.length > 5 ? 4 : 2;
        if (reasons.length < 4 && !reasons.includes(t)) reasons.push(t);
      }
    }

    // Industry match
    if (industry && hay.includes(industry.toLowerCase())) {
      score += 8;
      reasons.push(`industry:${industry}`);
    }

    // Stage-aware boosts
    if (stages.some((s) => /propos|quot|negotiat/i.test(s))) {
      if (/price|pricing|quote|proposal|rate/i.test(hay)) {
        score += 6;
        reasons.push("deal stage: pricing");
      }
    }
    if (stages.some((s) => /qualified|new|lead/i.test(s))) {
      if (/brochure|profile|intro|demo|company/i.test(hay)) {
        score += 5;
        reasons.push("deal stage: intro");
      }
    }

    // Popularity prior
    score += Math.min(10, (a.whatsappSendCount || 0) * 0.5 + (a.downloadCount || 0) * 0.2);

    // Kind diversity preference for kits
    if (a.kind === "pdf") score += 1;
    if (a.kind === "video") score += 0.5;

    if (score > 0) scored.push({ asset: a, score, reasons });
  }

  scored.sort((x, y) => y.score - x.score);

  // Diversify top results (prefer different names/kinds)
  const picked: Scored[] = [];
  const seenNames = new Set<string>();
  for (const s of scored) {
    const key = s.asset.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    picked.push(s);
    if (picked.length >= 8) break;
  }

  // Fallback: top shared if no matches
  if (!picked.length) {
    const fallback = assets.slice(0, 6);
    return {
      contact: {
        id: contact.id,
        name: contact.name,
        industry: contact.industry,
        tags: contact.tags,
        status: contact.status,
      },
      dealStages: stages,
      serviceHints: serviceHints.slice(0, 8),
      suggestions: fallback.map((a) => ({
        ...serializeAssetPublic(a, { folderName: a.folder?.name || null }),
        score: 1,
        reasons: ["popular"],
      })),
    };
  }

  return {
    contact: {
      id: contact.id,
      name: contact.name,
      industry: contact.industry,
      tags: contact.tags,
      status: contact.status,
    },
    dealStages: stages,
    serviceHints: serviceHints.slice(0, 8),
    suggestions: picked.map((s) => ({
      ...serializeAssetPublic(s.asset, { folderName: s.asset.folder?.name || null }),
      score: Math.round(s.score * 10) / 10,
      reasons: s.reasons.slice(0, 4),
    })),
  };
}

// ─── Natural language / AI search ────────────────────────────────────────────

export async function aiSearchMedia(userId: string, query: string) {
  const businessId = await requireBusiness(userId);
  const q = (query || "").trim();
  if (!q) throw new Error("Search query is required");

  const stop = new Set([
    "a",
    "an",
    "the",
    "find",
    "show",
    "get",
    "me",
    "my",
    "our",
    "file",
    "files",
    "please",
    "of",
    "for",
    "and",
    "or",
    "with",
    "latest",
    "new",
    "recent",
  ]);

  const tokens = q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !stop.has(t));

  const kindHint =
    /\b(video|videos|mp4)\b/i.test(q)
      ? "video"
      : /\b(pdf|brochure|brochures|document|documents)\b/i.test(q)
        ? "pdf"
        : /\b(image|images|logo|photo|picture)\b/i.test(q)
          ? "image"
          : null;

  const wantLatest = /\b(latest|newest|recent|new)\b/i.test(q);
  const wantPricing = /\b(pric|rate|quote|cost)\b/i.test(q);
  const wantLogo = /\blogo\b/i.test(q);
  const wantMarketing = /\b(market|campaign|offer|promo)\b/i.test(q);
  const wantProfile = /\b(company|profile|about)\b/i.test(q);

  const base = {
    businessId,
    deletedAt: null as null,
    archivedAt: null as null,
  };

  const assets = await prisma.mediaAsset.findMany({
    where: {
      ...base,
      ...(kindHint ? { kind: kindHint } : {}),
    },
    take: 300,
    orderBy: wantLatest ? { createdAt: "desc" } : { updatedAt: "desc" },
    include: { folder: { select: { id: true, name: true } } },
  });

  type Scored = { asset: (typeof assets)[0]; score: number };
  const scored: Scored[] = [];

  for (const a of assets) {
    let score = 0;
    const hay = [
      a.name,
      a.originalName,
      ...(a.tags || []),
      a.folder?.name || "",
      a.captionDefault || "",
      a.kind,
      a.mimeType,
    ]
      .join(" ")
      .toLowerCase();

    // Full phrase
    if (hay.includes(q.toLowerCase())) score += 20;

    for (const t of tokens) {
      if (hay.includes(t)) score += t.length > 4 ? 5 : 3;
      // fuzzy: token is prefix of a word
      if (hay.split(/\s+/).some((w) => w.startsWith(t))) score += 2;
    }

    if (wantPricing && /price|pricing|rate|quote|cost/i.test(hay)) score += 10;
    if (wantLogo && /logo/i.test(hay)) score += 15;
    if (wantMarketing && /market|campaign|offer|promo|brochure/i.test(hay)) score += 8;
    if (wantProfile && /company|profile|about|intro/i.test(hay)) score += 8;
    if (kindHint && a.kind === kindHint) score += 4;
    if (wantLatest) {
      const ageDays = (Date.now() - a.createdAt.getTime()) / 86400000;
      score += Math.max(0, 10 - ageDays);
    }

    // Popularity mild boost
    score += Math.min(5, (a.whatsappSendCount || 0) * 0.3);

    if (score > 0) scored.push({ asset: a, score });
  }

  scored.sort((x, y) => y.score - x.score);
  const top = scored.slice(0, 24);

  return {
    query: q,
    tokens,
    kindHint,
    totalMatched: scored.length,
    items: top.map((s) => ({
      ...serializeAssetPublic(s.asset, { folderName: s.asset.folder?.name || null }),
      relevance: Math.round(s.score * 10) / 10,
    })),
  };
}

// ─── Version history ─────────────────────────────────────────────────────────

export async function listVersions(userId: string, assetId: string) {
  const businessId = await requireBusiness(userId);
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId },
  });
  if (!asset) throw new Error("File not found");

  const versions = await prisma.mediaAssetVersion.findMany({
    where: { assetId, businessId },
    orderBy: { versionNumber: "desc" },
  });

  return {
    current: {
      versionNumber: asset.versionNumber,
      name: asset.name,
      sizeBytes: asset.sizeBytes,
      contentHash: asset.contentHash,
      updatedAt: asset.updatedAt.toISOString(),
    },
    versions: versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      name: v.name,
      originalName: v.originalName,
      mimeType: v.mimeType,
      kind: v.kind,
      sizeBytes: v.sizeBytes,
      contentHash: v.contentHash,
      createdByUserId: v.createdByUserId,
      note: v.note,
      createdAt: v.createdAt.toISOString(),
    })),
  };
}

export async function restoreVersion(userId: string, assetId: string, versionId: string) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can restore versions");
  const businessId = await requireBusiness(userId);
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
  });
  if (!asset) throw new Error("File not found");

  const version = await prisma.mediaAssetVersion.findFirst({
    where: { id: versionId, assetId, businessId },
  });
  if (!version) throw new Error("Version not found");

  // Snapshot current into versions table before restore
  await prisma.mediaAssetVersion.create({
    data: {
      businessId,
      assetId,
      versionNumber: asset.versionNumber,
      name: asset.name,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      kind: asset.kind,
      sizeBytes: asset.sizeBytes,
      storageKey: asset.storageKey,
      storageProvider: asset.storageProvider,
      contentHash: asset.contentHash,
      createdByUserId: userId,
      note: `Auto-snapshot before restore to v${version.versionNumber}`,
    },
  });

  const nextVersion = asset.versionNumber + 1;
  const updated = await prisma.mediaAsset.update({
    where: { id: assetId },
    data: {
      name: version.name,
      originalName: version.originalName,
      mimeType: version.mimeType,
      kind: version.kind,
      sizeBytes: version.sizeBytes,
      storageKey: version.storageKey,
      storageProvider: version.storageProvider,
      contentHash: version.contentHash,
      versionNumber: nextVersion,
      isLatestVersion: true,
    },
  });

  const actorName = await getActorLabel(userId);
  await recordAssetEvent({
    businessId,
    assetId,
    actorUserId: userId,
    actorName,
    action: "restored",
    detail: `Restored content from version ${version.versionNumber} → now v${nextVersion}`,
    metadata: { fromVersionId: versionId, fromVersion: version.versionNumber },
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "media_version_restore",
    entityType: "media_asset",
    entityId: assetId,
    metadata: { versionId, fromVersion: version.versionNumber, toVersion: nextVersion },
  });

  return serializeAssetPublic(updated);
}

// ─── Approval workflow ───────────────────────────────────────────────────────

export async function setApprovalStatus(
  userId: string,
  assetId: string,
  status: "approved" | "rejected" | "pending",
  reason?: string
) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can approve media");
  const businessId = await requireBusiness(userId);
  const existing = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("File not found");

  const data: Record<string, unknown> = { approvalStatus: status };
  if (status === "approved") {
    data.approvedByUserId = userId;
    data.approvedAt = new Date();
    data.rejectionReason = null;
  } else if (status === "rejected") {
    data.approvedByUserId = userId;
    data.approvedAt = null;
    data.rejectionReason = reason?.trim() || null;
  } else {
    data.approvedByUserId = null;
    data.approvedAt = null;
    data.rejectionReason = null;
  }

  const asset = await prisma.mediaAsset.update({
    where: { id: assetId },
    data: data as never,
  });

  const actorName = await getActorLabel(userId);
  await recordAssetEvent({
    businessId,
    assetId,
    actorUserId: userId,
    actorName,
    action: status === "approved" ? "approved" : status === "rejected" ? "rejected" : "pending",
    detail:
      status === "rejected" && reason
        ? `Rejected: ${reason}`
        : `Status set to ${status}`,
  });

  // Notify uploader if different
  if (existing.createdByUserId !== userId) {
    await notifyUser(existing.createdByUserId, {
      type: "system",
      title:
        status === "approved"
          ? "Media approved"
          : status === "rejected"
            ? "Media rejected"
            : "Media pending review",
      message: `"${existing.name}" is now ${status}.`,
      entityType: "media_asset",
      entityId: assetId,
    }).catch(() => undefined);
  }

  return serializeAssetPublic(asset);
}

// ─── Expiry & archive ────────────────────────────────────────────────────────

export async function setExpiry(
  userId: string,
  assetId: string,
  expiresAt: string | null
) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can set expiry");
  const businessId = await requireBusiness(userId);
  const existing = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("File not found");

  const exp = expiresAt ? new Date(expiresAt) : null;
  if (exp && Number.isNaN(exp.getTime())) throw new Error("Invalid expiry date");

  const asset = await prisma.mediaAsset.update({
    where: { id: assetId },
    data: { expiresAt: exp },
  });

  const actorName = await getActorLabel(userId);
  await recordAssetEvent({
    businessId,
    assetId,
    actorUserId: userId,
    actorName,
    action: "tagged",
    detail: exp ? `Expiry set to ${exp.toISOString().slice(0, 10)}` : "Expiry cleared",
    metadata: { expiresAt: exp?.toISOString() || null },
  });

  return serializeAssetPublic(asset);
}

export async function archiveAsset(
  userId: string,
  assetId: string,
  reason?: string
) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can archive");
  const businessId = await requireBusiness(userId);
  const existing = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("File not found");

  const asset = await prisma.mediaAsset.update({
    where: { id: assetId },
    data: {
      archivedAt: new Date(),
      archiveReason: reason?.trim() || "manual",
    },
  });

  const actorName = await getActorLabel(userId);
  await recordAssetEvent({
    businessId,
    assetId,
    actorUserId: userId,
    actorName,
    action: "archived",
    detail: reason || "Manually archived",
  });

  return serializeAssetPublic(asset);
}

export async function unarchiveAsset(userId: string, assetId: string) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can unarchive");
  const businessId = await requireBusiness(userId);
  const existing = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("File not found");

  const asset = await prisma.mediaAsset.update({
    where: { id: assetId },
    data: { archivedAt: null, archiveReason: null },
  });

  const actorName = await getActorLabel(userId);
  await recordAssetEvent({
    businessId,
    assetId,
    actorUserId: userId,
    actorName,
    action: "unarchived",
    detail: "Restored from archive",
  });

  return serializeAssetPublic(asset);
}

/** Cron-friendly: archive expired assets and notify admins */
export async function processExpiredMedia(businessId?: string) {
  const now = new Date();
  const where: Record<string, unknown> = {
    deletedAt: null,
    archivedAt: null,
    expiresAt: { lte: now },
  };
  if (businessId) where.businessId = businessId;

  const expired = await prisma.mediaAsset.findMany({
    where: where as never,
    take: 200,
  });

  let archived = 0;
  for (const asset of expired) {
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        archivedAt: now,
        archiveReason: "expired",
      },
    });
    await recordAssetEvent({
      businessId: asset.businessId,
      assetId: asset.id,
      actorUserId: null,
      actorName: "System",
      action: "expired",
      detail: `Auto-archived after expiry ${asset.expiresAt?.toISOString().slice(0, 10) || ""}`,
    });

    // Notify business admins
    const admins = await prisma.businessMember.findMany({
      where: {
        businessId: asset.businessId,
        role: { in: ["owner", "business_admin", "admin", "ceo"] },
      },
      select: { userId: true },
      take: 20,
    });
    for (const a of admins) {
      await notifyUser(a.userId, {
        type: "system",
        title: "Media expired & archived",
        message: `"${asset.name}" expired and was archived. It is hidden from Send Media.`,
        entityType: "media_asset",
        entityId: asset.id,
      }).catch(() => undefined);
    }
    archived++;
  }
  return { archived, checked: expired.length };
}

// ─── Public share links ──────────────────────────────────────────────────────

export async function createShareLink(
  userId: string,
  assetId: string,
  opts?: {
    expiresInDays?: number;
    password?: string;
    maxDownloads?: number;
  }
) {
  const businessId = await requireBusiness(userId);
  const asset = await prisma.mediaAsset.findFirst({
    where: {
      id: assetId,
      businessId,
      deletedAt: null,
      archivedAt: null,
      approvalStatus: "approved",
    },
  });
  if (!asset) throw new Error("File not found or not shareable");

  const days = Math.min(365, Math.max(1, opts?.expiresInDays ?? 7));
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const token = randomBytes(24).toString("base64url");
  const passwordHash = opts?.password?.trim()
    ? hashSharePassword(opts.password.trim())
    : null;

  const link = await prisma.mediaShareLink.create({
    data: {
      businessId,
      assetId,
      token,
      passwordHash,
      expiresAt,
      maxDownloads: opts?.maxDownloads ?? null,
      createdByUserId: userId,
    },
  });

  const actorName = await getActorLabel(userId);
  await recordAssetEvent({
    businessId,
    assetId,
    actorUserId: userId,
    actorName,
    action: "shared",
    detail: `Public link created (expires in ${days} day(s))`,
    metadata: { linkId: link.id, expiresAt: expiresAt.toISOString() },
  });

  return {
    id: link.id,
    token: link.token,
    path: `/api/media/public/${link.token}`,
    expiresAt: expiresAt.toISOString(),
    hasPassword: !!passwordHash,
    maxDownloads: link.maxDownloads,
    createdAt: link.createdAt.toISOString(),
  };
}

export async function revokeShareLink(userId: string, linkId: string) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can revoke links");
  const businessId = await requireBusiness(userId);
  const link = await prisma.mediaShareLink.findFirst({
    where: { id: linkId, businessId },
  });
  if (!link) throw new Error("Share link not found");
  await prisma.mediaShareLink.update({
    where: { id: linkId },
    data: { revokedAt: new Date() },
  });
  return { revoked: true };
}

export async function listShareLinks(userId: string, assetId: string) {
  const businessId = await requireBusiness(userId);
  const links = await prisma.mediaShareLink.findMany({
    where: { assetId, businessId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return links.map((l) => ({
    id: l.id,
    token: l.token,
    path: `/api/media/public/${l.token}`,
    expiresAt: l.expiresAt?.toISOString() || null,
    hasPassword: !!l.passwordHash,
    maxDownloads: l.maxDownloads,
    downloadCount: l.downloadCount,
    revokedAt: l.revokedAt?.toISOString() || null,
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function resolvePublicShare(
  token: string,
  opts?: { password?: string }
) {
  const link = await prisma.mediaShareLink.findFirst({
    where: { token, revokedAt: null },
    include: { asset: true },
  });
  if (!link) throw new Error("Link not found or revoked");
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    throw new Error("This share link has expired");
  }
  if (link.maxDownloads != null && link.downloadCount >= link.maxDownloads) {
    throw new Error("Download limit reached for this link");
  }
  if (link.passwordHash) {
    if (!opts?.password || !verifySharePassword(opts.password, link.passwordHash)) {
      const err = new Error("Password required or incorrect");
      (err as Error & { code?: string }).code = "PASSWORD_REQUIRED";
      throw err;
    }
  }
  const asset = link.asset;
  if (!asset || asset.deletedAt || asset.archivedAt) {
    throw new Error("File is no longer available");
  }

  await prisma.mediaShareLink.update({
    where: { id: link.id },
    data: { downloadCount: { increment: 1 } },
  });
  await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: {
      downloadCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });

  return {
    asset,
    stream: openMediaReadStream(asset.storageKey),
  };
}

// ─── Activity timeline ───────────────────────────────────────────────────────

export async function getAssetTimeline(userId: string, assetId: string) {
  const businessId = await requireBusiness(userId);
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId },
  });
  if (!asset) throw new Error("File not found");

  const [events, sends] = await Promise.all([
    prisma.mediaAssetEvent.findMany({
      where: { assetId, businessId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.mediaSendLog.findMany({
      where: { assetId, businessId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  type TimelineItem = {
    id: string;
    at: string;
    action: string;
    actorName: string | null;
    detail: string | null;
    source: "event" | "send";
  };

  const items: TimelineItem[] = [
    ...events.map((e) => ({
      id: e.id,
      at: e.createdAt.toISOString(),
      action: e.action,
      actorName: e.actorName,
      detail: e.detail,
      source: "event" as const,
    })),
    ...sends.map((s) => ({
      id: s.id,
      at: s.createdAt.toISOString(),
      action: "sent",
      actorName: s.sentByName,
      detail: `Sent to ${s.contactName || s.toPhone || "contact"} via ${s.channel} (${s.status})`,
      source: "send" as const,
    })),
  ];

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return { assetId, items: items.slice(0, 120) };
}

// ─── Global storage dashboard ────────────────────────────────────────────────

export async function getStorageDashboard(userId: string) {
  if (!(await canManageMedia(userId))) {
    throw new Error("Only Business Admin can view storage dashboard");
  }
  const businessId = await requireBusiness(userId);
  const quota = mediaQuotaBytes();
  const baseActive = { businessId, deletedAt: null as null, archivedAt: null as null };

  const [
    usedAgg,
    archivedAgg,
    deletedAgg,
    largest,
    unused,
    archivedFiles,
    deletedFiles,
    pendingCount,
    expiringCount,
  ] = await Promise.all([
    prisma.mediaAsset.aggregate({
      where: { businessId, deletedAt: null },
      _sum: { sizeBytes: true },
      _count: { _all: true },
    }),
    prisma.mediaAsset.aggregate({
      where: { businessId, deletedAt: null, archivedAt: { not: null } },
      _sum: { sizeBytes: true },
      _count: { _all: true },
    }),
    prisma.mediaAsset.aggregate({
      where: { businessId, deletedAt: { not: null } },
      _sum: { sizeBytes: true },
      _count: { _all: true },
    }),
    prisma.mediaAsset.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { sizeBytes: "desc" },
      take: 10,
      select: {
        id: true,
        name: true,
        kind: true,
        sizeBytes: true,
        createdAt: true,
        downloadCount: true,
        whatsappSendCount: true,
      },
    }),
    prisma.mediaAsset.findMany({
      where: {
        ...baseActive,
        downloadCount: 0,
        whatsappSendCount: 0,
        emailSendCount: 0,
        createdAt: { lte: new Date(Date.now() - 30 * 86400000) },
      },
      orderBy: { sizeBytes: "desc" },
      take: 15,
      select: {
        id: true,
        name: true,
        kind: true,
        sizeBytes: true,
        createdAt: true,
      },
    }),
    prisma.mediaAsset.findMany({
      where: { businessId, deletedAt: null, archivedAt: { not: null } },
      orderBy: { archivedAt: "desc" },
      take: 15,
      select: {
        id: true,
        name: true,
        kind: true,
        sizeBytes: true,
        archivedAt: true,
        archiveReason: true,
      },
    }),
    prisma.mediaAsset.findMany({
      where: { businessId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 15,
      select: {
        id: true,
        name: true,
        kind: true,
        sizeBytes: true,
        deletedAt: true,
      },
    }),
    prisma.mediaAsset.count({
      where: { businessId, deletedAt: null, approvalStatus: "pending" },
    }),
    prisma.mediaAsset.count({
      where: {
        businessId,
        deletedAt: null,
        archivedAt: null,
        expiresAt: {
          gte: new Date(),
          lte: new Date(Date.now() + 14 * 86400000),
        },
      },
    }),
  ]);

  const used = usedAgg._sum.sizeBytes || 0;
  const available = Math.max(0, quota - used);
  const unusedBytes = unused.reduce((s, f) => s + f.sizeBytes, 0);
  const archivedBytes = archivedAgg._sum.sizeBytes || 0;
  const deletedBytes = deletedAgg._sum.sizeBytes || 0;

  const suggestions: Array<{ type: string; message: string; potentialBytes: number }> = [];
  if (unused.length) {
    suggestions.push({
      type: "unused",
      message: `${unused.length} unused file(s) older than 30 days with no downloads or sends`,
      potentialBytes: unusedBytes,
    });
  }
  if (archivedBytes > 0) {
    suggestions.push({
      type: "archived",
      message: `${archivedAgg._count._all} archived file(s) can be permanently deleted to free space`,
      potentialBytes: archivedBytes,
    });
  }
  if (deletedBytes > 0) {
    suggestions.push({
      type: "deleted",
      message: `${deletedAgg._count._all} soft-deleted file(s) still occupy disk until purged`,
      potentialBytes: deletedBytes,
    });
  }
  if (used / quota > 0.8) {
    suggestions.push({
      type: "quota",
      message: "Storage is over 80% full — consider purging unused and archived assets",
      potentialBytes: 0,
    });
  }

  return {
    storage: {
      usedBytes: used,
      availableBytes: available,
      quotaBytes: quota,
      usedLabel: formatStorage(used),
      availableLabel: formatStorage(available),
      quotaLabel: formatStorage(quota),
      percentUsed: Math.round((used / quota) * 1000) / 10,
      totalFiles: usedAgg._count._all,
    },
    largestFiles: largest.map((f) => ({
      ...f,
      createdAt: f.createdAt.toISOString(),
      sizeLabel: formatStorage(f.sizeBytes),
    })),
    unusedFiles: unused.map((f) => ({
      ...f,
      createdAt: f.createdAt.toISOString(),
      sizeLabel: formatStorage(f.sizeBytes),
    })),
    archivedFiles: archivedFiles.map((f) => ({
      ...f,
      archivedAt: f.archivedAt?.toISOString() || null,
      sizeLabel: formatStorage(f.sizeBytes),
    })),
    deletedFiles: deletedFiles.map((f) => ({
      ...f,
      deletedAt: f.deletedAt?.toISOString() || null,
      sizeLabel: formatStorage(f.sizeBytes),
    })),
    counts: {
      pendingApproval: pendingCount,
      expiringSoon: expiringCount,
      archived: archivedAgg._count._all,
      deleted: deletedAgg._count._all,
    },
    cleanupSuggestions: suggestions.map((s) => ({
      ...s,
      potentialLabel: formatStorage(s.potentialBytes),
    })),
  };
}

export async function purgeDeletedAssets(userId: string, assetIds?: string[]) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can purge files");
  const businessId = await requireBusiness(userId);
  const where: Record<string, unknown> = {
    businessId,
    deletedAt: { not: null },
  };
  if (assetIds?.length) where.id = { in: assetIds };

  const rows = await prisma.mediaAsset.findMany({
    where: where as never,
    take: 100,
  });

  let purged = 0;
  for (const row of rows) {
    await deleteMediaFile(row.storageKey).catch(() => undefined);
    // Also purge version blobs
    const versions = await prisma.mediaAssetVersion.findMany({
      where: { assetId: row.id },
    });
    for (const v of versions) {
      if (v.storageKey !== row.storageKey) {
        await deleteMediaFile(v.storageKey).catch(() => undefined);
      }
    }
    await prisma.mediaAsset.delete({ where: { id: row.id } });
    purged++;
  }
  return { purged };
}

// Re-export for upload path
export { touchLastUsed, recordAssetEvent, readMediaBuffer };
export type { SerializedMediaAsset };
