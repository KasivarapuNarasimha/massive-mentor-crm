import { prisma } from "../lib/prisma.js";
import {
  andTenant,
  buildCrmScope,
  buildOwnedEntityScope,
} from "./tenant-scope.service.js";
import { toMoneyNumber } from "../lib/money.js";

/**
 * Tenant-scoped dashboard analytics — FULL dataset aggregates only.
 * Never paginate / LIMIT chart inputs (would under-count large imports).
 */
export async function getReportsDashboard(userId: string) {
  // Align tenant with list/import (reclaim deleted-workspace contacts first)
  try {
    const { getUserBusinessId, reclaimContactsFromDeletedBusinesses } = await import(
      "./field-engine.service.js"
    );
    const activeBiz = await getUserBusinessId(userId);
    if (activeBiz) await reclaimContactsFromDeletedBusinesses(userId, activeBiz);
  } catch {
    /* non-fatal */
  }

  const contactScope = await buildCrmScope(userId);
  const dealScope = await buildOwnedEntityScope(userId);
  const contactWhere = andTenant(contactScope.where, { deletedAt: null });
  const leadWhere = andTenant(contactWhere, { type: "lead" });
  const clientWhere = andTenant(contactWhere, { type: "client" });
  const dealWhere = dealScope.where;
  const taskWhere = dealScope.where;
  const meetingWhere = dealScope.where;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date();
  dayEnd.setHours(23, 59, 59, 999);

  // Six-month window for trends
  const monthsBack = 6;
  const trendStart = new Date();
  trendStart.setDate(1);
  trendStart.setHours(0, 0, 0, 0);
  trendStart.setMonth(trendStart.getMonth() - (monthsBack - 1));

  const dayTrendStart = new Date();
  dayTrendStart.setHours(0, 0, 0, 0);
  dayTrendStart.setDate(dayTrendStart.getDate() - 13); // last 14 days inclusive

  const [
    leads,
    clients,
    totalDeals,
    tasksOpen,
    meetingsTodayCount,
    leadSourceGroups,
    leadStatusGroups,
    dealStageGroups,
    dealOwnerGroups,
    wonCount,
    lostCount,
    pipelineAgg,
    totalValueAgg,
    monthlyPipeline,
    monthlyWon,
    dailyLeadMap,
  ] = await Promise.all([
    prisma.contact.count({ where: leadWhere as never }),
    prisma.contact.count({ where: clientWhere as never }),
    prisma.deal.count({ where: dealWhere as never }),
    prisma.task.count({
      where: andTenant(taskWhere, {
        status: { notIn: ["done", "completed"] },
      }) as never,
    }),
    prisma.meeting.count({
      where: andTenant(meetingWhere, {
        scheduledAt: { gte: dayStart, lt: dayEnd },
      }) as never,
    }),
    prisma.contact.groupBy({
      by: ["source"],
      where: leadWhere as never,
      _count: { _all: true },
    }),
    prisma.contact.groupBy({
      by: ["status"],
      where: leadWhere as never,
      _count: { _all: true },
    }),
    prisma.deal.groupBy({
      by: ["stage"],
      where: dealWhere as never,
      _count: { _all: true },
      _sum: { value: true },
    }),
    prisma.deal.groupBy({
      by: ["userId"],
      where: dealWhere as never,
      _count: { _all: true },
      _sum: { value: true },
    }),
    prisma.deal.count({
      where: andTenant(dealWhere, { stage: "closed_won" }) as never,
    }),
    prisma.deal.count({
      where: andTenant(dealWhere, { stage: "closed_lost" }) as never,
    }),
    prisma.deal.aggregate({
      where: andTenant(dealWhere, {
        stage: { notIn: ["closed_won", "closed_lost"] },
      }) as never,
      _sum: { value: true },
    }),
    prisma.deal.aggregate({
      where: dealWhere as never,
      _sum: { value: true },
    }),
    aggregateDealsByMonth(userId, dealScope, "createdAt", trendStart, null),
    aggregateDealsByMonth(userId, dealScope, "updatedAt", trendStart, "closed_won"),
    aggregateLeadsByDay(userId, contactScope, dayTrendStart),
  ]);

  const closedDeals = wonCount + lostCount;
  const conversionRate =
    closedDeals > 0 ? Math.round((wonCount / closedDeals) * 100) : 0;

  const byStage: Record<string, number> = {};
  const pipelineByStage: Array<{ stage: string; count: number; value: number }> = [];
  for (const g of dealStageGroups) {
    const count = g._count._all;
    const value = toMoneyNumber(g._sum.value);
    byStage[g.stage] = count;
    pipelineByStage.push({ stage: g.stage, count, value });
  }

  // Lead sources — full count must equal totalLeads
  const leadSources = leadSourceGroups
    .map((g) => ({
      name: (g.source && String(g.source).trim()) || "Unknown",
      value: g._count._all,
    }))
    .sort((a, b) => b.value - a.value);

  // Collapse duplicate "Unknown" labels after trim
  const sourceMerged = new Map<string, number>();
  for (const s of leadSources) {
    sourceMerged.set(s.name, (sourceMerged.get(s.name) || 0) + s.value);
  }
  const leadSourcesMerged = Array.from(sourceMerged.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const leadSourcesTotal = leadSourcesMerged.reduce((s, x) => s + x.value, 0);

  // Leads by status (full tenant)
  const leadsByStatus = leadStatusGroups
    .map((g) => ({
      name: (g.status && String(g.status).trim()) || "unknown",
      value: g._count._all,
      revenue: 0,
      filter: { type: "lead", status: g.status || "unknown" },
    }))
    .sort((a, b) => b.value - a.value);

  // Revenue by executive (deal owner)
  const ownerIds = dealOwnerGroups.map((g) => g.userId).filter(Boolean);
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const ownerName = new Map(
    owners.map((o) => [o.id, o.name || o.email?.split("@")[0] || o.id.slice(0, 8)])
  );
  const revenueByExecutive = dealOwnerGroups
    .map((g) => ({
      name: ownerName.get(g.userId) || "Unknown",
      value: toMoneyNumber(g._sum.value),
      count: g._count._all,
      userId: g.userId,
      filter: { executiveId: g.userId },
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  // Daily lead creation (14 days)
  const dailyLeadTrend: Array<{ name: string; value: number; key: string }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    dailyLeadTrend.push({
      name: label,
      key,
      value: dailyLeadMap.get(key) || 0,
    });
  }

  // Conversion funnel (ordered stages)
  const FUNNEL_ORDER = [
    "lead",
    "new",
    "contacted",
    "qualified",
    "proposal",
    "negotiation",
    "closed_won",
  ];
  const stageCountMap = new Map(pipelineByStage.map((s) => [s.stage, s]));
  const conversionFunnel = FUNNEL_ORDER.map((stage) => {
    const hit = stageCountMap.get(stage);
    return {
      name: stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      stage,
      value: hit?.count || 0,
      revenue: hit?.value || 0,
      filter: { stage },
    };
  }).filter((s, idx, arr) => {
    // Keep stages that have data or are between first/last with data
    if (s.value > 0) return true;
    const hasLater = arr.slice(idx + 1).some((x) => x.value > 0);
    const hasEarlier = arr.slice(0, idx).some((x) => x.value > 0);
    return hasLater && hasEarlier;
  });
  // Always include won if any closed
  if (wonCount > 0 && !conversionFunnel.some((f) => f.stage === "closed_won")) {
    conversionFunnel.push({
      name: "Closed Won",
      stage: "closed_won",
      value: wonCount,
      revenue: pipelineByStage.find((s) => s.stage === "closed_won")?.value || 0,
      filter: { stage: "closed_won" },
    });
  }

  // Build last N months labels so empty months still appear as 0
  const revenueTrend: Array<{
    name: string;
    value: number;
    key: string;
    previous?: number;
  }> = [];
  const monthlySales: Array<{
    name: string;
    value: number;
    key: string;
    previous?: number;
  }> = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const prevKey = (() => {
      const p = new Date(d);
      p.setMonth(p.getMonth() - 1);
      return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
    })();
    const label = d.toLocaleString(undefined, { month: "short" });
    const rev = monthlyPipeline.get(key) || 0;
    const prevRev = monthlyPipeline.get(prevKey) || 0;
    const sold = monthlyWon.get(key) || 0;
    const prevSold = monthlyWon.get(prevKey) || 0;
    revenueTrend.push({
      name: label,
      key,
      value: rev,
      previous: prevRev,
    });
    monthlySales.push({
      name: label,
      key,
      value: sold,
      previous: prevSold,
    });
  }

  // Attach growth % to lead sources
  const leadSourcesWithMeta = leadSourcesMerged.map((s) => ({
    ...s,
    percent: leadSourcesTotal > 0 ? (s.value / leadSourcesTotal) * 100 : 0,
    revenue: 0,
    filter: { type: "lead", source: s.name === "Unknown" ? "" : s.name },
  }));

  return {
    totalLeads: leads,
    totalClients: clients,
    totalDealValue: toMoneyNumber(totalValueAgg._sum.value),
    pipelineValue: toMoneyNumber(pipelineAgg._sum.value),
    conversionRate,
    tasksDue: tasksOpen,
    meetingsToday: meetingsTodayCount,
    dealsByStage: byStage,
    pipelineByStage,
    totalDeals,
    leadSources: leadSourcesWithMeta,
    leadSourcesTotal,
    revenueTrend,
    monthlySales,
    leadsByStatus,
    revenueByExecutive,
    dailyLeadTrend,
    conversionFunnel,
    wonDeals: wonCount,
    lostDeals: lostCount,
  };
}

/**
 * Month buckets for deal value using SQL date_trunc — no row limit.
 */
async function aggregateDealsByMonth(
  userId: string,
  dealScope: Awaited<ReturnType<typeof buildOwnedEntityScope>>,
  dateField: "createdAt" | "updatedAt",
  from: Date,
  stage: string | null
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const col = dateField === "createdAt" ? `"createdAt"` : `"updatedAt"`;

  // Prefer businessId path (indexed); fall back to userId for own-data roles / legacy
  if (dealScope.businessId && !dealScope.ownDataOnly) {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ ym: string; total: unknown }>
    >(
      `SELECT to_char(date_trunc('month', ${col}), 'YYYY-MM') AS ym,
              COALESCE(SUM("value"), 0) AS total
       FROM "Deal"
       WHERE "businessId" = $1
         AND ${col} >= $2
         ${stage ? `AND stage = $3` : ""}
       GROUP BY 1
       ORDER BY 1`,
      ...(stage
        ? [dealScope.businessId, from, stage]
        : [dealScope.businessId, from])
    );
    for (const r of rows) {
      map.set(String(r.ym), toMoneyNumber(r.total));
    }
    return map;
  }

  if (dealScope.businessId && dealScope.ownDataOnly) {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ ym: string; total: unknown }>
    >(
      `SELECT to_char(date_trunc('month', ${col}), 'YYYY-MM') AS ym,
              COALESCE(SUM("value"), 0) AS total
       FROM "Deal"
       WHERE "businessId" = $1
         AND "userId" = $2
         AND ${col} >= $3
         ${stage ? `AND stage = $4` : ""}
       GROUP BY 1
       ORDER BY 1`,
      ...(stage
        ? [dealScope.businessId, userId, from, stage]
        : [dealScope.businessId, userId, from])
    );
    for (const r of rows) {
      map.set(String(r.ym), toMoneyNumber(r.total));
    }
    return map;
  }

  // Legacy / no business: user-owned deals only
  const rows = await prisma.$queryRawUnsafe<
    Array<{ ym: string; total: unknown }>
  >(
    `SELECT to_char(date_trunc('month', ${col}), 'YYYY-MM') AS ym,
            COALESCE(SUM("value"), 0) AS total
     FROM "Deal"
     WHERE "userId" = $1
       AND ${col} >= $2
       ${stage ? `AND stage = $3` : ""}
     GROUP BY 1
     ORDER BY 1`,
    ...(stage ? [userId, from, stage] : [userId, from])
  );
  for (const r of rows) {
    map.set(String(r.ym), toMoneyNumber(r.total));
  }
  return map;
}

/** Daily lead creation counts — no row limit. */
async function aggregateLeadsByDay(
  userId: string,
  contactScope: Awaited<ReturnType<typeof buildCrmScope>>,
  from: Date
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (contactScope.businessId && !contactScope.ownDataOnly) {
    const rows = await prisma.$queryRawUnsafe<Array<{ d: string; n: number }>>(
      `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS d,
              COUNT(*)::int AS n
       FROM "Contact"
       WHERE "businessId" = $1
         AND type = 'lead'
         AND "deletedAt" IS NULL
         AND "createdAt" >= $2
       GROUP BY 1
       ORDER BY 1`,
      contactScope.businessId,
      from
    );
    for (const r of rows) map.set(String(r.d), Number(r.n) || 0);
    return map;
  }
  if (contactScope.businessId && contactScope.ownDataOnly) {
    const ids =
      contactScope.visibleUserIds && contactScope.visibleUserIds.length
        ? contactScope.visibleUserIds
        : [userId];
    const rows = await prisma.$queryRawUnsafe<Array<{ d: string; n: number }>>(
      `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS d,
              COUNT(*)::int AS n
       FROM "Contact"
       WHERE "businessId" = $1
         AND ("userId" = ANY($2::text[]) OR "assignedTo" = ANY($2::text[]))
         AND type = 'lead'
         AND "deletedAt" IS NULL
         AND "createdAt" >= $3
       GROUP BY 1
       ORDER BY 1`,
      contactScope.businessId,
      ids,
      from
    );
    for (const r of rows) map.set(String(r.d), Number(r.n) || 0);
    return map;
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ d: string; n: number }>>(
    `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS d,
            COUNT(*)::int AS n
     FROM "Contact"
     WHERE "userId" = $1
       AND type = 'lead'
       AND "deletedAt" IS NULL
       AND "createdAt" >= $2
     GROUP BY 1
     ORDER BY 1`,
    userId,
    from
  );
  for (const r of rows) map.set(String(r.d), Number(r.n) || 0);
  return map;
}

export async function exportContactsToCsv(userId: string, type?: "lead" | "client") {
  const module = type === "client" ? "clients" : type === "lead" ? "leads" : "contacts";
  return exportModuleCsv(userId, module as ExportModule);
}

export async function exportDealsToCsv(userId: string) {
  return exportModuleCsv(userId, "deals");
}

// Contact CSV/Excel import — implementation in import-contacts.service.ts
export type {
  ImportRowError,
  ImportReport,
  ImportPreview,
  ColumnMapping,
  ImportOptions,
  CrmImportField,
  ColumnSuggestion,
} from "./import-contacts.service.js";
export {
  importContactsFromCsv,
  importContactsFromFile,
  previewImportFromCsv,
  previewImportFromFile,
} from "./import-contacts.service.js";

export async function exportContactsToPdf(
  userId: string,
  type?: "lead" | "client",
  res?: NodeJS.WritableStream
) {
  const module = type === "client" ? "clients" : type === "lead" ? "leads" : "contacts";
  if (!res) {
    throw new Error("PDF export requires a writable response stream");
  }
  await exportModulePdf(userId, module as ExportModule, undefined, res);
}

export async function exportDealsToPdf(userId: string, res?: NodeJS.WritableStream) {
  if (!res) {
    throw new Error("PDF export requires a writable response stream");
  }
  await exportModulePdf(userId, "deals", undefined, res);
}

// =====================================================
// Universal multi-module export (CSV / PDF / Excel)
// =====================================================

export type ExportModule =
  | "leads"
  | "clients"
  | "contacts"
  | "deals"
  | "tasks"
  | "meetings"
  | "documents"
  | "invoices"
  | "expenses"
  | "payments"
  | "activity"
  | "audit";

export type ExportFilters = {
  search?: string;
  from?: string; // ISO date
  to?: string;
  status?: string;
  stage?: string;
  /** Filter contacts by assignee userId; "unassigned" for null */
  assignedTo?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

/** Display date for exports: 14-Aug-2026 */
function formatExportDate(d: Date | null | undefined): string {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const day = String(d.getDate()).padStart(2, "0");
  const mon = months[d.getMonth()] || "";
  const year = d.getFullYear();
  return `${day}-${mon}-${year}`;
}

/**
 * Resolve Contact.assignedTo ids → display names (scoped users).
 * Also builds latest assignment date per contact from LeadAssignment history when available.
 */
async function resolveAssigneeMaps(
  contacts: Array<{ id: string; assignedTo: string | null; lastContactedAt: Date | null }>
): Promise<{
  nameByUserId: Map<string, string>;
  assignedDateByContactId: Map<string, Date>;
}> {
  const userIds = [
    ...new Set(
      contacts
        .map((c) => c.assignedTo)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const nameByUserId = new Map<string, string>();
  if (userIds.length) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    for (const u of users) {
      nameByUserId.set(u.id, (u.name && u.name.trim()) || u.email || u.id);
    }
    // Legacy free-text assignees (name/email stored before userId)
    for (const id of userIds) {
      if (!nameByUserId.has(id)) {
        nameByUserId.set(id, id.includes("@") || id.length < 24 ? id : "Assigned user");
      }
    }
  }

  const assignedDateByContactId = new Map<string, Date>();
  const contactIds = contacts.filter((c) => c.assignedTo).map((c) => c.id);
  if (contactIds.length) {
    // Latest assignment batch date per contact (tenant history)
    try {
      const items = await prisma.leadAssignmentItem.findMany({
        where: { contactId: { in: contactIds } },
        select: {
          contactId: true,
          batch: { select: { createdAt: true } },
        },
      });
      for (const it of items) {
        const at = it.batch?.createdAt;
        if (!at) continue;
        const prev = assignedDateByContactId.get(it.contactId);
        if (!prev || at > prev) assignedDateByContactId.set(it.contactId, at);
      }
    } catch {
      /* history table may be empty / unavailable — fall back below */
    }
    // Fallback: lastContactedAt is set on assign when history missing
    for (const c of contacts) {
      if (!c.assignedTo) continue;
      if (assignedDateByContactId.has(c.id)) continue;
      if (c.lastContactedAt) assignedDateByContactId.set(c.id, c.lastContactedAt);
    }
  }

  return { nameByUserId, assignedDateByContactId };
}

function buildAssignmentSummaryFromRows(
  rows: Array<{ assignedToId: string; assignedToName: string }>
): {
  totalLeads: number;
  assignedLeads: number;
  unassignedLeads: number;
  byMember: Array<{ name: string; count: number }>;
} {
  const totalLeads = rows.length;
  let assignedLeads = 0;
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.assignedToId) {
      assignedLeads++;
      const key = r.assignedToName || "Unknown";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const byMember = Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    totalLeads,
    assignedLeads,
    unassignedLeads: totalLeads - assignedLeads,
    byMember,
  };
}

function dateRange(from?: string, to?: string) {
  if (!from && !to) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = new Date(from);
  if (to) {
    const d = new Date(to);
    d.setHours(23, 59, 59, 999);
    range.lte = d;
  }
  return range;
}

/** Max rows for memory-bound formats; CSV streams can go higher via batches */
export const EXPORT_MAX_ROWS = 100_000;
const EXPORT_BATCH = 2_500;

/**
 * Cursor-paginate Prisma findMany by id (stable for large exports).
 */
async function fetchAllBatched<T extends { id: string }>(
  fetchPage: (cursor: string | undefined, take: number) => Promise<T[]>,
  maxRows = EXPORT_MAX_ROWS
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  while (all.length < maxRows) {
    const take = Math.min(EXPORT_BATCH, maxRows - all.length);
    const page = await fetchPage(cursor, take);
    if (!page.length) break;
    all.push(...page);
    if (page.length < take) break;
    cursor = page[page.length - 1]!.id;
  }
  return all;
}

export type ExportResult = {
  headers: string[];
  rows: unknown[][];
  title: string;
  /** Present for lead/client/contact exports — used by PDF/XLSX summary section */
  assignmentSummary?: {
    totalLeads: number;
    assignedLeads: number;
    unassignedLeads: number;
    byMember: Array<{ name: string; count: number }>;
  };
};

export async function fetchExportRows(
  userId: string,
  module: ExportModule,
  filters: ExportFilters = {}
): Promise<ExportResult> {
  const createdAt = dateRange(filters.from, filters.to);
  const search = filters.search?.trim();
  const contactScope = await buildCrmScope(userId);
  const ownedScope = await buildOwnedEntityScope(userId);

  switch (module) {
    case "leads":
    case "clients":
    case "contacts": {
      const type =
        module === "leads" ? "lead" : module === "clients" ? "client" : undefined;
      const extra: Record<string, unknown> = { deletedAt: null };
      if (type) extra.type = type;
      if (filters.status) extra.status = filters.status;
      if (createdAt) extra.createdAt = createdAt;
      if (filters.assignedTo) {
        const a = String(filters.assignedTo).trim();
        if (a === "unassigned" || a === "__unassigned__" || a === "null") {
          extra.assignedTo = null;
        } else if (a) {
          extra.assignedTo = a;
        }
      }
      if (search) {
        extra.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { company: { contains: search, mode: "insensitive" } },
        ];
      }
      const where = andTenant(contactScope.where, extra);
      const items = await fetchAllBatched(async (cursor, take) => {
        return prisma.contact.findMany({
          where: where as never,
          orderBy: [{ createdAt: filters.sortDir === "asc" ? "asc" : "desc" }, { id: "asc" }],
          take,
          ...(cursor
            ? {
                skip: 1,
                cursor: { id: cursor },
              }
            : {}),
        });
      });

      const { nameByUserId, assignedDateByContactId } = await resolveAssigneeMaps(
        items.map((c) => ({
          id: c.id,
          assignedTo: c.assignedTo,
          lastContactedAt: c.lastContactedAt,
        }))
      );

      const detailMeta = items.map((c) => {
        const aid = c.assignedTo || "";
        const aname = aid ? nameByUserId.get(aid) || aid : "Unassigned";
        return { assignedToId: aid, assignedToName: aname };
      });
      const assignmentSummary = buildAssignmentSummaryFromRows(detailMeta);

      return {
        title: module === "leads" ? "Leads" : module === "clients" ? "Clients" : "Contacts",
        headers: [
          "Lead Name",
          "Contact/Phone",
          "Email",
          "Company",
          "Status",
          "Assigned To",
          "Assigned Date",
          "Source",
          "Priority",
          "Value",
          "AI Score",
          "Created At",
          "id",
          "type",
        ],
        rows: items.map((c, i) => {
          const meta = detailMeta[i]!;
          const assignedDate = assignedDateByContactId.get(c.id);
          return [
            c.name,
            c.phone || "",
            c.email || "",
            c.company || "",
            c.status,
            meta.assignedToName,
            formatExportDate(assignedDate),
            c.source || "",
            c.priority || "",
            c.value ?? "",
            c.aiScore ?? "",
            c.createdAt.toISOString(),
            c.id,
            c.type,
          ];
        }),
        assignmentSummary,
      };
    }
    case "deals": {
      const extra: Record<string, unknown> = {};
      if (filters.stage) extra.stage = filters.stage;
      if (createdAt) extra.createdAt = createdAt;
      if (search) extra.title = { contains: search, mode: "insensitive" };
      const where = andTenant(ownedScope.where, extra);
      const items = await fetchAllBatched(async (cursor, take) => {
        return prisma.deal.findMany({
          where: where as never,
          include: { contact: { select: { name: true } } },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
      });
      return {
        title: "Deals",
        headers: [
          "id",
          "title",
          "value",
          "stage",
          "probability",
          "contact",
          "expectedClose",
          "createdAt",
        ],
        rows: items.map((d) => [
          d.id,
          d.title,
          d.value ?? "",
          d.stage,
          d.probability ?? "",
          d.contact?.name || "",
          d.expectedClose?.toISOString().split("T")[0] || "",
          d.createdAt.toISOString(),
        ]),
      };
    }
    case "tasks": {
      const where: Record<string, unknown> = { userId };
      if (filters.status) where.status = filters.status;
      if (createdAt) where.createdAt = createdAt;
      if (search) where.title = { contains: search, mode: "insensitive" };
      const items = await fetchAllBatched(async (cursor, take) => {
        return prisma.task.findMany({
          where: where as never,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
      });
      return {
        title: "Tasks",
        headers: ["id", "title", "status", "priority", "dueDate", "createdAt"],
        rows: items.map((t) => [
          t.id,
          t.title,
          t.status,
          t.priority || "",
          t.dueDate?.toISOString() || "",
          t.createdAt.toISOString(),
        ]),
      };
    }
    case "meetings": {
      const where: Record<string, unknown> = { userId };
      if (createdAt) where.scheduledAt = createdAt;
      if (search) where.title = { contains: search, mode: "insensitive" };
      const items = await fetchAllBatched(async (cursor, take) => {
        return prisma.meeting.findMany({
          where: where as never,
          orderBy: [{ scheduledAt: "desc" }, { id: "asc" }],
          take,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
      });
      return {
        title: "Meetings",
        headers: ["id", "title", "scheduledAt", "durationMin", "outcome", "createdAt"],
        rows: items.map((m) => [
          m.id,
          m.title,
          m.scheduledAt.toISOString(),
          m.durationMin ?? "",
          m.outcome || "",
          m.createdAt.toISOString(),
        ]),
      };
    }
    case "documents": {
      const where: Record<string, unknown> = { userId };
      if (createdAt) where.createdAt = createdAt;
      if (search) where.title = { contains: search, mode: "insensitive" };
      const items = await fetchAllBatched(async (cursor, take) => {
        return prisma.document.findMany({
          where: where as never,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
      });
      return {
        title: "Documents",
        headers: ["id", "title", "url", "entityType", "entityId", "createdAt"],
        rows: items.map((d) => [
          d.id,
          d.title,
          d.url || "",
          d.entityType || "",
          d.entityId || "",
          d.createdAt.toISOString(),
        ]),
      };
    }
    case "invoices": {
      const { getUserBusinessId } = await import("./field-engine.service.js");
      const businessId = await getUserBusinessId(userId);
      const where: Record<string, unknown> = businessId ? { businessId } : { userId };
      if (filters.status) where.status = filters.status;
      if (createdAt) where.createdAt = createdAt;
      if (search) {
        where.OR = [
          { clientName: { contains: search, mode: "insensitive" } },
          { number: { contains: search, mode: "insensitive" } },
        ];
      }
      const items = await fetchAllBatched(async (cursor, take) => {
        return prisma.invoice.findMany({
          where: where as never,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
      });
      return {
        title: "Invoices",
        headers: [
          "id",
          "number",
          "clientName",
          "amount",
          "taxAmount",
          "total",
          "currency",
          "status",
          "dueDate",
          "createdAt",
        ],
        rows: items.map((i) => [
          i.id,
          i.number,
          i.clientName || "",
          i.amount,
          i.taxAmount,
          i.total,
          i.currency || "INR",
          i.status,
          i.dueDate?.toISOString().split("T")[0] || "",
          i.createdAt.toISOString(),
        ]),
      };
    }
    case "expenses": {
      const { getUserBusinessId } = await import("./field-engine.service.js");
      const businessId = await getUserBusinessId(userId);
      const where: Record<string, unknown> = businessId ? { businessId } : { userId };
      if (createdAt) where.expenseDate = createdAt;
      if (search) where.title = { contains: search, mode: "insensitive" };
      const items = await fetchAllBatched(async (cursor, take) => {
        return prisma.expense.findMany({
          where: where as never,
          orderBy: [{ expenseDate: "desc" }, { id: "asc" }],
          take,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
      });
      return {
        title: "Expenses",
        headers: ["id", "title", "category", "amount", "total", "currency", "vendor", "expenseDate"],
        rows: items.map((e) => [
          e.id,
          e.title,
          e.category,
          e.amount,
          e.total,
          e.currency || "INR",
          e.vendor || "",
          e.expenseDate.toISOString().split("T")[0],
        ]),
      };
    }
    case "payments": {
      const { getUserBusinessId } = await import("./field-engine.service.js");
      const businessId = await getUserBusinessId(userId);
      const where: Record<string, unknown> = businessId ? { businessId } : { userId };
      if (createdAt) where.paidAt = createdAt;
      const items = await fetchAllBatched(async (cursor, take) => {
        return prisma.payment.findMany({
          where: where as never,
          include: { invoice: { select: { number: true, clientName: true, currency: true } } },
          orderBy: [{ paidAt: "desc" }, { id: "asc" }],
          take,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
      });
      return {
        title: "Payments",
        headers: ["id", "amount", "currency", "method", "reference", "invoice", "client", "paidAt"],
        rows: items.map((p) => [
          p.id,
          p.amount,
          p.invoice?.currency || "INR",
          p.method,
          p.reference || "",
          p.invoice?.number || "",
          p.invoice?.clientName || "",
          p.paidAt.toISOString(),
        ]),
      };
    }
    case "activity":
    case "audit": {
      const where: Record<string, unknown> = { actorUserId: userId };
      if (createdAt) where.createdAt = createdAt;
      if (search) {
        where.OR = [
          { action: { contains: search, mode: "insensitive" } },
          { entityType: { contains: search, mode: "insensitive" } },
        ];
      }
      const items = await fetchAllBatched(async (cursor, take) => {
        return prisma.auditLog.findMany({
          where: where as never,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
      });
      return {
        title: "Audit Log",
        headers: ["id", "action", "entityType", "entityId", "createdAt"],
        rows: items.map((a) => [
          a.id,
          a.action,
          a.entityType || "",
          a.entityId || "",
          a.createdAt.toISOString(),
        ]),
      };
    }
    default:
      throw new Error(`Unknown export module: ${module}`);
  }
}

export async function exportModuleCsv(
  userId: string,
  module: ExportModule,
  filters?: ExportFilters
): Promise<string> {
  const { buildCsvString } = await import("./export-format.service.js");
  const { headers, rows } = await fetchExportRows(userId, module, filters);
  return buildCsvString(headers, rows, { bom: true });
}

/** Stream CSV directly to response (preferred for large datasets). */
export async function exportModuleCsvStream(
  userId: string,
  module: ExportModule,
  filters: ExportFilters | undefined,
  res: NodeJS.WritableStream
): Promise<void> {
  const { streamCsvTo } = await import("./export-format.service.js");
  const { headers, rows } = await fetchExportRows(userId, module, filters);
  streamCsvTo(res, headers, rows, { bom: true });
}

export async function exportModulePdf(
  userId: string,
  module: ExportModule,
  filters: ExportFilters | undefined,
  res: NodeJS.WritableStream
): Promise<void> {
  const { streamPdfTable } = await import("./export-format.service.js");
  const { headers, rows, title, assignmentSummary } = await fetchExportRows(
    userId,
    module,
    filters
  );
  await streamPdfTable(res, {
    title,
    headers,
    rows,
    maxRows: 15_000,
    assignmentSummary:
      module === "leads" || module === "clients" || module === "contacts"
        ? assignmentSummary
        : undefined,
  });
}

export async function exportModuleXlsx(
  userId: string,
  module: ExportModule,
  filters?: ExportFilters
): Promise<Buffer> {
  const { buildXlsxBuffer, buildMultiSheetXlsxBuffer } = await import(
    "./export-format.service.js"
  );
  const { headers, rows, title, assignmentSummary } = await fetchExportRows(
    userId,
    module,
    filters
  );

  if (
    assignmentSummary &&
    (module === "leads" || module === "clients" || module === "contacts")
  ) {
    const summaryHeaders = ["Sales Executive", "Leads Assigned"];
    const summaryRows: unknown[][] = assignmentSummary.byMember.map((m) => [
      m.name,
      m.count,
    ]);
    // Total row = sum of per-member assigned counts (matches dashboard assignment table)
    summaryRows.push(["Total", assignmentSummary.assignedLeads]);
    // Totals block below member table
    summaryRows.push([]);
    summaryRows.push(["Metric", "Count"]);
    summaryRows.push(["Total Leads", assignmentSummary.totalLeads]);
    summaryRows.push(["Assigned Leads", assignmentSummary.assignedLeads]);
    summaryRows.push(["Unassigned Leads", assignmentSummary.unassignedLeads]);

    return buildMultiSheetXlsxBuffer([
      { name: "Assignment Summary", headers: summaryHeaders, rows: summaryRows },
      { name: title, headers, rows },
    ]);
  }

  return buildXlsxBuffer(title, headers, rows);
}