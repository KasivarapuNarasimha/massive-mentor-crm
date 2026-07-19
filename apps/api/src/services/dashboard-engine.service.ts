import { prisma } from "@/lib/prisma";
import { getBusinessConfig } from "@/services/template.service";
import { getUserBusinessId } from "@/services/field-engine.service";
import { buildCrmScope, buildOwnedEntityScope } from "@/services/tenant-scope.service";
import { countContacts } from "@/services/crm.service";

export type DateRangeQuery = {
  preset?: "all" | "7d" | "30d" | "90d" | "ytd" | "custom";
  from?: string;
  to?: string;
};

export type WidgetRuntimeResult = {
  widgetKey: string;
  type: string;
  chartType?: string;
  title: string;
  value?: number | null;
  series?: Array<{ name: string; value: number }>;
  items?: Array<Record<string, unknown>>;
  drillDown?: { enabled: boolean; entity?: string; route?: string; filterField?: string };
  meta?: Record<string, unknown>;
};

type WidgetDef = {
  key: string;
  type: string;
  chartType?: string;
  title: string;
  source: {
    entity: string;
    filters?: Array<{ field: string; op: string; value?: unknown }>;
    aggregate?: string;
    aggregateField?: string;
    groupBy?: string;
    limit?: number;
    dateField?: string;
  };
  rolesCanView?: string[];
  drillDown?: { enabled: boolean; entity?: string; route?: string };
  dateRange?: DateRangeQuery;
};

type DashboardDef = {
  key: string;
  label: string;
  description?: string;
  roles?: string[];
  isDefault?: boolean;
  widgets: WidgetDef[];
};

function resolveDateBounds(range?: DateRangeQuery): { gte?: Date; lte?: Date } {
  if (!range || !range.preset || range.preset === "all") return {};
  const now = new Date();
  const lte = range.to ? new Date(range.to) : now;
  if (range.preset === "custom") {
    return {
      gte: range.from ? new Date(range.from) : undefined,
      lte: range.to ? new Date(range.to) : undefined,
    };
  }
  const gte = new Date(now);
  if (range.preset === "7d") gte.setDate(gte.getDate() - 7);
  else if (range.preset === "30d") gte.setDate(gte.getDate() - 30);
  else if (range.preset === "90d") gte.setDate(gte.getDate() - 90);
  else if (range.preset === "ytd") {
    gte.setMonth(0, 1);
    gte.setHours(0, 0, 0, 0);
  }
  return { gte, lte };
}

/**
 * Build Prisma where from generic filters — never industry-specific.
 */
function buildWhere(
  userId: string,
  businessId: string | null,
  source: WidgetDef["source"],
  range?: DateRangeQuery,
  scopeWhere?: Record<string, unknown>
): Record<string, unknown> {
  // Prefer precomputed role+tenant scope (SE own-data isolation)
  const tenant: Record<string, unknown> =
    scopeWhere ||
    (businessId
      ? { OR: [{ businessId }, { userId, businessId: null }] }
      : { userId });

  const extra: Record<string, unknown> = {};

  for (const f of source.filters || []) {
    const field = f.field;
    if (field.includes(".")) continue; // customFields path handled later in post-filter
    switch (f.op) {
      case "eq":
        extra[field] = f.value;
        break;
      case "neq":
        extra[field] = { not: f.value };
        break;
      case "gt":
        extra[field] = { gt: f.value };
        break;
      case "gte":
        extra[field] = { gte: f.value };
        break;
      case "lt":
        extra[field] = { lt: f.value };
        break;
      case "lte":
        extra[field] = { lte: f.value };
        break;
      case "in":
        extra[field] = { in: f.value };
        break;
      case "is_null":
        extra[field] = null;
        break;
      case "not_null":
        extra[field] = { not: null };
        break;
      default:
        break;
    }
  }

  const bounds = resolveDateBounds(range);
  const dateField = source.dateField || "createdAt";
  if (bounds.gte || bounds.lte) {
    const existing = (extra[dateField] as Record<string, unknown>) || {};
    extra[dateField] = {
      ...existing,
      ...(bounds.gte ? { gte: bounds.gte } : {}),
      ...(bounds.lte ? { lte: bounds.lte } : {}),
    };
  }

  if (Object.keys(extra).length === 0) return tenant;
  return { AND: [tenant, extra] };
}

async function countEntity(entity: string, where: Record<string, unknown>): Promise<number> {
  switch (entity) {
    case "contact":
      return prisma.contact.count({ where: where as never });
    case "deal":
      return prisma.deal.count({ where: where as never });
    case "task":
      return prisma.task.count({ where: where as never });
    case "meeting":
      return prisma.meeting.count({ where: where as never });
    default:
      return 0;
  }
}

/**
 * Contact KPI counts must match Leads module exactly:
 * same buildCrmScope + type/status filters via countContacts().
 * Only applies when there is no date-range restriction (Leads list is not date-filtered).
 * Never counts AI recommendations, notifications, activity, or import side-tables.
 */
function contactFiltersFromSource(
  source: WidgetDef["source"]
): { type?: "lead" | "client"; status?: string } {
  const out: { type?: "lead" | "client"; status?: string } = {};
  for (const f of source.filters || []) {
    if (f.op !== "eq" || f.field.includes(".")) continue;
    if (f.field === "type" && (f.value === "lead" || f.value === "client")) {
      out.type = f.value;
    }
    if (f.field === "status" && typeof f.value === "string") {
      out.status = f.value;
    }
  }
  return out;
}

function hasDateRestriction(range?: DateRangeQuery): boolean {
  if (!range || !range.preset || range.preset === "all") return false;
  return true;
}

async function sumEntity(
  entity: string,
  where: Record<string, unknown>,
  field: string
): Promise<number> {
  if (entity === "deal" && field === "value") {
    const agg = await prisma.deal.aggregate({ where: where as never, _sum: { value: true } });
    return agg._sum.value || 0;
  }
  if (entity === "contact" && field === "value") {
    const agg = await prisma.contact.aggregate({ where: where as never, _sum: { value: true } });
    return agg._sum.value || 0;
  }
  return 0;
}

async function fetchEntityRows(
  entity: string,
  where: Record<string, unknown>,
  limit?: number
): Promise<Array<Record<string, unknown>>> {
  // Higher cap for chart grouping; count-only paths use countEntity
  const take = limit && limit > 0 ? Math.min(limit, 20000) : 20000;
  switch (entity) {
    case "contact":
      return prisma.contact.findMany({
        where: where as never,
        take,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          value: true,
          createdAt: true,
          updatedAt: true,
          customFields: true,
        },
      }) as Promise<Array<Record<string, unknown>>>;
    case "deal":
      return prisma.deal.findMany({
        where: where as never,
        take,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          stage: true,
          value: true,
          createdAt: true,
          updatedAt: true,
        },
      }) as Promise<Array<Record<string, unknown>>>;
    case "task":
      return prisma.task.findMany({
        where: where as never,
        take,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          createdAt: true,
          updatedAt: true,
        },
      }) as Promise<Array<Record<string, unknown>>>;
    case "meeting":
      return prisma.meeting.findMany({
        where: where as never,
        take,
        orderBy: { scheduledAt: "desc" },
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          createdAt: true,
        },
      }) as Promise<Array<Record<string, unknown>>>;
    default:
      return [];
  }
}

function getGroupKey(row: Record<string, unknown>, groupBy: string): string {
  if (groupBy === "createdAt_day" || groupBy === "updatedAt_day") {
    const field = groupBy.replace("_day", "");
    const d = row[field] ? new Date(String(row[field])) : null;
    if (!d || Number.isNaN(d.getTime())) return "unknown";
    return d.toISOString().slice(0, 10);
  }
  if (groupBy.startsWith("customFields.")) {
    const key = groupBy.slice("customFields.".length);
    const cf = (row.customFields || {}) as Record<string, unknown>;
    return String(cf[key] ?? "unknown");
  }
  const v = row[groupBy];
  return v == null || v === "" ? "unknown" : String(v);
}

function aggregateSeries(
  rows: Array<Record<string, unknown>>,
  source: WidgetDef["source"]
): Array<{ name: string; value: number }> {
  const groupBy = source.groupBy;
  if (!groupBy) {
    if (source.aggregate === "sum" && source.aggregateField) {
      const sum = rows.reduce((s, r) => s + (Number(r[source.aggregateField!]) || 0), 0);
      return [{ name: "total", value: sum }];
    }
    return [{ name: "total", value: rows.length }];
  }

  const map = new Map<string, number>();
  for (const row of rows) {
    const key = getGroupKey(row, groupBy);
    if (source.aggregate === "sum" && source.aggregateField) {
      map.set(key, (map.get(key) || 0) + (Number(row[source.aggregateField]) || 0));
    } else {
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function roleCanViewWidget(widget: WidgetDef, role: string): boolean {
  if (!widget.rolesCanView || widget.rolesCanView.length === 0) return true;
  return widget.rolesCanView.includes(role);
}

function dashboardMatchesRole(dash: DashboardDef, role: string): boolean {
  if (!dash.roles || dash.roles.length === 0) return true;
  // Map legacy roles
  const aliases: Record<string, string[]> = {
    admin: ["admin", "business_admin", "owner"],
    manager: ["manager", "sales_manager"],
    sales_executive: ["sales_executive"],
    owner: ["owner", "ceo"],
  };
  if (dash.roles.includes(role)) return true;
  for (const r of dash.roles) {
    if (aliases[role]?.includes(r)) return true;
    if (aliases[r]?.includes(role)) return true;
  }
  return false;
}

export async function listDashboardsForUser(userId: string, role: string) {
  const businessId = await getUserBusinessId(userId);
  const config = businessId ? await getBusinessConfig(businessId) : null;
  const dashboards = (config?.dashboards as DashboardDef[]) || [];
  if (!Array.isArray(dashboards) || dashboards.length === 0) {
    return { businessId, dashboards: [] as DashboardDef[], role };
  }
  const visible = dashboards.filter((d) => dashboardMatchesRole(d, role));
  // Always include default main if nothing matches
  if (visible.length === 0) {
    const main = dashboards.find((d) => d.isDefault) || dashboards[0];
    return { businessId, dashboards: main ? [main] : [], role };
  }
  return { businessId, dashboards: visible, role };
}

export async function evaluateDashboard(
  userId: string,
  role: string,
  dashboardKey: string,
  range?: DateRangeQuery
): Promise<{ dashboard: DashboardDef | null; widgets: WidgetRuntimeResult[] }> {
  const { dashboards, businessId } = await listDashboardsForUser(userId, role);
  const dash =
    dashboards.find((d) => d.key === dashboardKey) ||
    dashboards.find((d) => d.isDefault) ||
    dashboards[0] ||
    null;
  if (!dash) return { dashboard: null, widgets: [] };

  // Role-aware CRM scope (Sales Executive = own data only)
  const contactScope = await buildCrmScope(userId);
  const ownedScope = await buildOwnedEntityScope(userId);

  const results: WidgetRuntimeResult[] = [];
  for (const widget of dash.widgets || []) {
    if (!roleCanViewWidget(widget, role)) continue;
    const effectiveRange = range || widget.dateRange;
    const entity = widget.source.entity;
    const scopeWhere =
      entity === "contact" || entity === "feedback"
        ? contactScope.where
        : ownedScope.where;
    const where = buildWhere(userId, businessId, widget.source, effectiveRange, scopeWhere);

    // Fast path: simple KPI count/sum without groupBy
    if (
      (widget.type === "metric_kpi" ||
        widget.type === "metric_count" ||
        widget.type === "metric_sum" ||
        widget.type === "tasks_due" ||
        widget.type === "nps_average") &&
      !widget.source.groupBy &&
      widget.chartType !== "gauge" &&
      !widget.key.includes("gauge")
    ) {
      let value = 0;
      if (widget.source.aggregate === "sum" && widget.source.aggregateField) {
        value = await sumEntity(widget.source.entity, where, widget.source.aggregateField);
      } else if (
        widget.source.entity === "contact" &&
        (widget.source.aggregate === "count" || !widget.source.aggregate) &&
        !hasDateRestriction(effectiveRange)
      ) {
        // Align with GET /crm/contacts?type=lead total (Leads module)
        value = await countContacts(userId, contactFiltersFromSource(widget.source));
      } else {
        value = await countEntity(widget.source.entity, where);
      }
      results.push({
        widgetKey: widget.key,
        type: widget.type,
        title: widget.title,
        value,
        meta: {
          source: "contact_count_parity",
          entity: widget.source.entity,
        },
      });
      continue;
    }

    const rows = await fetchEntityRows(widget.source.entity, where, widget.source.limit);

    if (widget.type === "list" || widget.type === "tasks_due" || widget.type === "feedback_recent") {
      results.push({
        widgetKey: widget.key,
        type: widget.type,
        title: widget.title,
        items: rows.slice(0, widget.source.limit || 10).map((r) => ({
          id: r.id,
          title: r.title || r.name,
          status: r.status || r.stage,
          dueDate: r.dueDate,
          value: r.value,
        })),
        drillDown: widget.drillDown
          ? { enabled: !!widget.drillDown.enabled, entity: widget.drillDown.entity, route: widget.drillDown.route }
          : undefined,
      });
      continue;
    }

    if (widget.type === "chart" || widget.type === "pipeline_funnel") {
      const series = aggregateSeries(rows, widget.source);
      // Gauge: conversion = won / total * 100 when groupBy status
      if (widget.chartType === "gauge") {
        const won = series
          .filter((s) => /won|closed_won/i.test(s.name))
          .reduce((a, b) => a + b.value, 0);
        const total = series.reduce((a, b) => a + b.value, 0) || 1;
        results.push({
          widgetKey: widget.key,
          type: "chart",
          chartType: "gauge",
          title: widget.title,
          value: Math.round((won / total) * 100),
          series,
          drillDown: widget.drillDown
            ? {
                enabled: !!widget.drillDown.enabled,
                entity: widget.source.entity,
                route: widget.drillDown.route || "/dashboard/leads",
                filterField: widget.source.groupBy,
              }
            : undefined,
          meta: { max: 100, unit: "%" },
        });
        continue;
      }
      results.push({
        widgetKey: widget.key,
        type: "chart",
        chartType: widget.chartType || (widget.type === "pipeline_funnel" ? "funnel" : "bar"),
        title: widget.title,
        series,
        drillDown: widget.drillDown
          ? {
              enabled: !!widget.drillDown.enabled,
              entity: widget.source.entity,
              route: widget.drillDown.route || "/dashboard/leads",
              filterField: widget.source.groupBy,
            }
          : undefined,
      });
      continue;
    }

    // metric_count / metric_sum / metric_kpi / tasks_due as number
    const series = aggregateSeries(rows, widget.source);
    let value = series[0]?.value ?? rows.length;
    if (widget.key.includes("gauge") || widget.chartType === "gauge") {
      const won = series.filter((s) => /won|closed_won/i.test(s.name)).reduce((a, b) => a + b.value, 0);
      const total = series.reduce((a, b) => a + b.value, 0) || 1;
      value = Math.round((won / total) * 100);
    }
    results.push({
      widgetKey: widget.key,
      type: widget.type,
      title: widget.title,
      value,
      series,
    });
  }

  return { dashboard: dash, widgets: results };
}
