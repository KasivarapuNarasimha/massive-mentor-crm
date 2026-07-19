import { prisma } from "@/lib/prisma";
import {
  andTenant,
  buildCrmScope,
  buildOwnedEntityScope,
} from "@/services/tenant-scope.service";
import { toMoneyNumber } from "@/lib/money";

let PDFDocument: any = null;
async function getPDFDocument() {
  if (!PDFDocument) {
    // @ts-ignore - pdfkit has no types; runtime dynamic import is safe (used in PDF export)
    PDFDocument = (await import("pdfkit")).default;
  }
  return PDFDocument;
}

/**
 * Tenant-scoped dashboard analytics — FULL dataset aggregates only.
 * Never paginate / LIMIT chart inputs (would under-count large imports).
 */
export async function getReportsDashboard(userId: string) {
  // Align tenant with list/import (reclaim deleted-workspace contacts first)
  try {
    const { getUserBusinessId, reclaimContactsFromDeletedBusinesses } = await import(
      "@/services/field-engine.service"
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
    const rows = await prisma.$queryRawUnsafe<Array<{ d: string; n: number }>>(
      `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS d,
              COUNT(*)::int AS n
       FROM "Contact"
       WHERE "businessId" = $1
         AND ("userId" = $2 OR "assignedTo" = $2)
         AND type = 'lead'
         AND "deletedAt" IS NULL
         AND "createdAt" >= $3
       GROUP BY 1
       ORDER BY 1`,
      contactScope.businessId,
      userId,
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
  const scope = await buildCrmScope(userId);
  const where = andTenant(scope.where, {
    deletedAt: null,
    ...(type ? { type } : {}),
  });

  const contacts = await prisma.contact.findMany({
    where: where as never,
    take: 10000,
  });

  const headers = ["id", "type", "name", "email", "phone", "company", "status", "value", "source"];
  const rows = contacts.map((c) => [
    c.id,
    c.type,
    c.name,
    c.email || "",
    c.phone || "",
    c.company || "",
    c.status,
    c.value || "",
    c.source || "",
  ]);

  return [headers, ...rows].map((row) => row.join(",")).join("\n");
}

export async function exportDealsToCsv(userId: string) {
  const scope = await buildOwnedEntityScope(userId);
  const deals = await prisma.deal.findMany({
    where: scope.where as never,
    include: { contact: { select: { name: true } } },
    take: 10000,
  });

  const headers = ["id", "title", "value", "stage", "probability", "contact", "expectedClose"];
  const rows = deals.map((d) => [
    d.id,
    d.title,
    d.value || "",
    d.stage,
    d.probability || "",
    d.contact?.name || "",
    d.expectedClose ? d.expectedClose.toISOString().split("T")[0] : "",
  ]);

  return [headers, ...rows].map((row) => row.join(",")).join("\n");
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
} from "@/services/import-contacts.service";
export {
  importContactsFromCsv,
  importContactsFromFile,
  previewImportFromCsv,
  previewImportFromFile,
} from "@/services/import-contacts.service";

export async function exportContactsToPdf(userId: string, type?: "lead" | "client", res?: any) {
  const where: any = { userId };
  if (type) where.type = type;

  const contacts = await prisma.contact.findMany({ where });

  const PDF = await getPDFDocument();
  const doc = new PDF({ margin: 30, size: "A4" });
  if (res) {
    doc.pipe(res);
  }

  doc.fontSize(16).text(`Contacts Export${type ? ` (${type})` : ""}`, { align: "center" });
  doc.moveDown();

  const headers = ["ID", "Type", "Name", "Email", "Phone", "Company", "Status", "Value", "Source"];
  let y = doc.y;
  doc.fontSize(8);

  // Header
  headers.forEach((h, i) => {
    doc.text(h, 30 + i * 60, y, { width: 55, continued: i < headers.length - 1 });
  });
  y += 15;
  doc.moveTo(30, y - 5).lineTo(30 + headers.length * 60, y - 5).stroke();

  contacts.forEach((c, idx) => {
    if (y > 750) {
      doc.addPage();
      y = 50;
    }
    const row = [
      c.id.substring(0, 8),
      c.type,
      c.name.substring(0, 15),
      (c.email || "").substring(0, 15),
      (c.phone || "").substring(0, 12),
      (c.company || "").substring(0, 12),
      c.status,
      c.value ? String(c.value) : "",
      (c.source || "").substring(0, 10),
    ];
    row.forEach((val, i) => {
      doc.text(val, 30 + i * 60, y, { width: 55 });
    });
    y += 12;
  });

  doc.end();
}

export async function exportDealsToPdf(userId: string, res?: any) {
  const scope = await buildOwnedEntityScope(userId);
  const deals = await prisma.deal.findMany({
    where: scope.where as never,
    include: { contact: { select: { name: true } } },
    take: 10000,
  });

  const PDF = await getPDFDocument();
  const doc = new PDF({ margin: 30, size: "A4" });
  if (res) {
    doc.pipe(res);
  }

  doc.fontSize(16).text("Deals Export", { align: "center" });
  doc.moveDown();

  const headers = ["ID", "Title", "Value", "Stage", "Prob", "Contact", "Close"];
  let y = doc.y;
  doc.fontSize(8);

  headers.forEach((h, i) => {
    doc.text(h, 30 + i * 70, y, { width: 65, continued: i < headers.length - 1 });
  });
  y += 15;
  doc.moveTo(30, y - 5).lineTo(30 + headers.length * 70, y - 5).stroke();

  deals.forEach((d) => {
    if (y > 750) {
      doc.addPage();
      y = 50;
    }
    const row = [
      d.id.substring(0, 8),
      d.title.substring(0, 20),
      d.value ? String(d.value) : "",
      d.stage,
      d.probability ? String(d.probability) : "",
      (d.contact?.name || "").substring(0, 12),
      d.expectedClose ? d.expectedClose.toISOString().split("T")[0] : "",
    ];
    row.forEach((val, i) => {
      doc.text(val, 30 + i * 70, y, { width: 65 });
    });
    y += 12;
  });

  doc.end();
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
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

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

function escapeCsv(val: unknown): string {
  const s = val == null ? "" : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");
}

export async function fetchExportRows(
  userId: string,
  module: ExportModule,
  filters: ExportFilters = {}
): Promise<{ headers: string[]; rows: unknown[][]; title: string }> {
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
      if (search) {
        extra.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { company: { contains: search, mode: "insensitive" } },
        ];
      }
      const where = andTenant(contactScope.where, extra);
      const items = await prisma.contact.findMany({
        where: where as never,
        orderBy: { createdAt: filters.sortDir === "asc" ? "asc" : "desc" },
        take: 5000,
      });
      return {
        title: module === "leads" ? "Leads" : module === "clients" ? "Clients" : "Contacts",
        headers: ["id", "type", "name", "email", "phone", "company", "status", "value", "source", "createdAt"],
        rows: items.map((c) => [
          c.id,
          c.type,
          c.name,
          c.email || "",
          c.phone || "",
          c.company || "",
          c.status,
          c.value ?? "",
          c.source || "",
          c.createdAt.toISOString(),
        ]),
      };
    }
    case "deals": {
      const extra: Record<string, unknown> = {};
      if (filters.stage) extra.stage = filters.stage;
      if (createdAt) extra.createdAt = createdAt;
      if (search) extra.title = { contains: search, mode: "insensitive" };
      const where = andTenant(ownedScope.where, extra);
      const items = await prisma.deal.findMany({
        where: where as never,
        include: { contact: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      return {
        title: "Deals",
        headers: ["id", "title", "value", "stage", "probability", "contact", "expectedClose", "createdAt"],
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
      const items = await prisma.task.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        take: 5000,
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
      const items = await prisma.meeting.findMany({
        where: where as never,
        orderBy: { scheduledAt: "desc" },
        take: 5000,
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
      const items = await prisma.document.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        take: 5000,
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
      const { getUserBusinessId } = await import("@/services/field-engine.service");
      const businessId = await getUserBusinessId(userId);
      const where: Record<string, unknown> = businessId
        ? { businessId }
        : { userId };
      if (filters.status) where.status = filters.status;
      if (createdAt) where.createdAt = createdAt;
      if (search) {
        where.OR = [
          { clientName: { contains: search, mode: "insensitive" } },
          { number: { contains: search, mode: "insensitive" } },
        ];
      }
      const items = await prisma.invoice.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        take: 5000,
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
      const { getUserBusinessId } = await import("@/services/field-engine.service");
      const businessId = await getUserBusinessId(userId);
      const where: Record<string, unknown> = businessId
        ? { businessId }
        : { userId };
      if (createdAt) where.expenseDate = createdAt;
      if (search) where.title = { contains: search, mode: "insensitive" };
      const items = await prisma.expense.findMany({
        where: where as never,
        orderBy: { expenseDate: "desc" },
        take: 5000,
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
      const { getUserBusinessId } = await import("@/services/field-engine.service");
      const businessId = await getUserBusinessId(userId);
      const where: Record<string, unknown> = businessId
        ? { businessId }
        : { userId };
      if (createdAt) where.paidAt = createdAt;
      const items = await prisma.payment.findMany({
        where: where as never,
        include: { invoice: { select: { number: true, clientName: true, currency: true } } },
        orderBy: { paidAt: "desc" },
        take: 5000,
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
      // Prefer AuditLog; fall back to Activity
      const where: Record<string, unknown> = {};
      // Audit is business-scoped; filter by actor
      where.actorUserId = userId;
      if (createdAt) where.createdAt = createdAt;
      if (search) {
        where.OR = [
          { action: { contains: search, mode: "insensitive" } },
          { entityType: { contains: search, mode: "insensitive" } },
        ];
      }
      const items = await prisma.auditLog.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        take: 5000,
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
  const { headers, rows } = await fetchExportRows(userId, module, filters);
  return rowsToCsv(headers, rows);
}

export async function exportModulePdf(
  userId: string,
  module: ExportModule,
  filters: ExportFilters | undefined,
  res: NodeJS.WritableStream
): Promise<void> {
  const { headers, rows, title } = await fetchExportRows(userId, module, filters);
  const PDF = await getPDFDocument();
  const doc = new PDF({ margin: 30, size: "A4", layout: headers.length > 6 ? "landscape" : "portrait" });
  doc.pipe(res);
  doc.fontSize(14).text(`${title} Export`, { align: "center" });
  doc.fontSize(8).fillColor("#666").text(`Generated ${new Date().toISOString()}`, { align: "center" });
  doc.moveDown();
  doc.fillColor("#000").fontSize(7);
  const colW = Math.min(90, Math.floor(750 / Math.max(headers.length, 1)));
  let y = doc.y;
  headers.forEach((h, i) => {
    doc.text(String(h).slice(0, 12), 30 + i * colW, y, { width: colW - 2 });
  });
  y += 12;
  doc.moveTo(30, y - 2).lineTo(30 + headers.length * colW, y - 2).stroke();
  for (const row of rows.slice(0, 800)) {
    if (y > 520) {
      doc.addPage();
      y = 40;
    }
    row.forEach((val, i) => {
      doc.text(String(val ?? "").slice(0, 18), 30 + i * colW, y, { width: colW - 2 });
    });
    y += 10;
  }
  doc.end();
}

export async function exportModuleXlsx(
  userId: string,
  module: ExportModule,
  filters?: ExportFilters
): Promise<Buffer> {
  const { headers, rows, title } = await fetchExportRows(userId, module, filters);
  const XLSX = await import("xlsx");
  const data = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}