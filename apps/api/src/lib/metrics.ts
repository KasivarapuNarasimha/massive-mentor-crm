/**
 * In-process performance metrics (no external deps).
 * Reset-friendly; suitable for /health and ops dashboards.
 */
import os from "node:os";

type LatencyBucket = {
  count: number;
  sumMs: number;
  maxMs: number;
  slowCount: number; // > 1000ms
};

const httpByRoute = new Map<string, LatencyBucket>();
let httpTotal = 0;
let httpErrors = 0;
let dbQuerySamples = 0;
let dbQuerySumMs = 0;
let dbQueryMaxMs = 0;

const SLOW_MS = 1000;
const MAX_ROUTE_KEYS = 200;

function bucketKey(method: string, path: string): string {
  // Strip IDs to avoid cardinality explosion
  const normalized = path
    .replace(/\/[a-z0-9]{20,}/gi, "/:id")
    .replace(/\/\d+/g, "/:n")
    .split("?")[0]
    .slice(0, 120);
  return `${method} ${normalized}`;
}

function ensureBucket(map: Map<string, LatencyBucket>, key: string): LatencyBucket {
  let b = map.get(key);
  if (!b) {
    if (map.size >= MAX_ROUTE_KEYS) {
      // Drop arbitrary old key
      const first = map.keys().next().value;
      if (first) map.delete(first);
    }
    b = { count: 0, sumMs: 0, maxMs: 0, slowCount: 0 };
    map.set(key, b);
  }
  return b;
}

export function recordHttpMetric(method: string, path: string, status: number, ms: number) {
  httpTotal++;
  if (status >= 500) httpErrors++;
  const b = ensureBucket(httpByRoute, bucketKey(method, path));
  b.count++;
  b.sumMs += ms;
  if (ms > b.maxMs) b.maxMs = ms;
  if (ms >= SLOW_MS) b.slowCount++;
}

export function recordDbLatency(ms: number) {
  dbQuerySamples++;
  dbQuerySumMs += ms;
  if (ms > dbQueryMaxMs) dbQueryMaxMs = ms;
}

export function getMetricsSnapshot() {
  const routes = [...httpByRoute.entries()]
    .map(([route, b]) => ({
      route,
      count: b.count,
      avgMs: b.count ? Math.round((b.sumMs / b.count) * 10) / 10 : 0,
      maxMs: b.maxMs,
      slowCount: b.slowCount,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const mem = process.memoryUsage();
  return {
    http: {
      totalRequests: httpTotal,
      error5xx: httpErrors,
      topRoutes: routes,
    },
    database: {
      samples: dbQuerySamples,
      avgMs:
        dbQuerySamples > 0
          ? Math.round((dbQuerySumMs / dbQuerySamples) * 10) / 10
          : null,
      maxMs: dbQueryMaxMs || null,
    },
    process: {
      uptimeSec: Math.round(process.uptime()),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      // loadavg is zeros/unavailable on Windows
      loadAvg: process.platform === "win32" ? null : os.loadavg(),
    },
  };
}
