/**
 * Request ID + structured HTTP access logging.
 * Must run early; enriches finish log with user after auth middleware runs.
 */
import type { Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import type { AuthenticatedRequest } from "./auth.js";
import { log } from "../lib/logger.js";
import { recordHttpMetric } from "../lib/metrics.js";

export function requestContext(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const incoming = req.headers["x-request-id"];
  const requestId =
    (typeof incoming === "string" && incoming.trim()) || randomUUID();
  req.requestId = requestId;
  req.requestStartedAt = Date.now();
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const ms = Date.now() - (req.requestStartedAt || Date.now());
    const path = req.originalUrl || req.url || "";
    // Skip ultra-noisy health probes in access logs (still counted in metrics)
    const isProbe = path === "/health" || path === "/ready";
    recordHttpMetric(req.method, path, res.statusCode, ms);

    if (isProbe && res.statusCode < 400 && ms < 200) return;

    const user = req.user;
    const tenant = req.tenant;
    log.info("http.request", {
      requestId,
      method: req.method,
      endpoint: path.split("?")[0],
      statusCode: res.statusCode,
      responseTimeMs: ms,
      userId: user?.id,
      role: user?.role || user?.platformRole,
      businessId: tenant?.businessId ?? null,
      portal: req.portal,
      ip: req.ip,
      userAgent: typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"].slice(0, 200)
        : undefined,
      slow: ms >= 1000,
    });
  });

  next();
}

/** Attach requestId to error logs from error middleware */
export function getRequestId(req: AuthenticatedRequest): string | undefined {
  return req.requestId;
}
