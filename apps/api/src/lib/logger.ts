/**
 * Production structured logger.
 * - JSON lines in production (easy for log shippers)
 * - Human-readable in development
 * - Never logs secrets, JWTs, or raw passwords
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|api[_-]?key|cookie|jwt|private|credential|smtp_pass|access_token|refresh_token/i;

const isProd = () => process.env.NODE_ENV === "production";

/** Redact sensitive keys and mask phone-like values in strings. */
export function sanitizeLogValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    // Mask long JWTs / bearer tokens
    if (/^Bearer\s+/i.test(value) || (value.length > 40 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value))) {
      return "[REDACTED_TOKEN]";
    }
    // Mask E.164-ish phone numbers (keep last 4)
    return value.replace(
      /(\+?\d{1,3}[\s-]?)?(\d{6,})(\d{4})\b/g,
      (_m, a, mid, last) => `${a || ""}******${last}`
    );
  }
  if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
    return sanitizeLogFields(value as LogFields);
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => sanitizeLogValue(String(i), v));
  }
  return value;
}

export function sanitizeLogFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    out[k] = sanitizeLogValue(k, v);
  }
  return out;
}

function write(level: LogLevel, message: string, fields?: LogFields) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    service: "massive-mentor-api",
    ...(fields ? sanitizeLogFields(fields) : {}),
  };

  if (isProd()) {
    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    return;
  }

  // Dev: compact readable
  const extra = fields && Object.keys(fields).length
    ? " " +
      Object.entries(sanitizeLogFields(fields))
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ")
    : "";
  const line = `[${level}] ${message}${extra}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (message: string, fields?: LogFields) => {
    if (!isProd()) write("debug", message, fields);
  },
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};

/** Log an Error with stack + optional request context (no secrets). */
export function logError(
  err: unknown,
  context?: LogFields & {
    module?: string;
    file?: string;
    function?: string;
    requestId?: string;
    userId?: string;
    businessId?: string | null;
  }
) {
  const error = err instanceof Error ? err : new Error(String(err));
  log.error(error.message, {
    ...context,
    errName: error.name,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });
}
