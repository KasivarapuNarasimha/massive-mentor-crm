/**
 * Turn audit/activity/notification payloads into user-friendly copy.
 * Raw JSON is never the primary UI — only for optional developer debug.
 */

const ENTITY_LABELS: Record<string, string> = {
  contact: "Contact",
  lead: "Lead",
  client: "Client",
  deal: "Deal",
  task: "Task",
  meeting: "Meeting",
  document: "Document",
  invoice: "Invoice",
  expense: "Expense",
  payment: "Payment",
  user: "User",
  business: "Business",
  whatsapp_message: "WhatsApp",
  notification: "Notification",
  system: "System",
};

const ACTION_LABELS: Record<string, string> = {
  create: "Created",
  created: "Created",
  update: "Updated",
  updated: "Updated",
  delete: "Deleted",
  deleted: "Deleted",
  login: "Signed in",
  logout: "Signed out",
  register: "Registered",
  import: "Imported",
  export: "Exported",
  ai: "AI action",
  config_change: "Configuration changed",
  ensure_business: "Business ready",
  sent: "Sent",
  failed: "Failed",
  whatsapp_opened: "WhatsApp opened",
  whatsapp_sent_manual: "WhatsApp Sent (Manual)",
  whatsapp_send_cancelled: "WhatsApp send cancelled",
  whatsapp_basic_open: "WhatsApp opened",
};

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  name: "Name",
  email: "Email",
  number: "Number",
  total: "Total",
  amount: "Amount",
  status: "Status",
  oldStatus: "Previous status",
  newStatus: "New status",
  stage: "Stage",
  templateSlug: "Template",
  businessName: "Business",
  industryLabel: "Industry",
  source: "Source",
  to: "To",
  waMessageId: "Message ID",
  templateName: "Template",
  count: "Count",
  imported: "Imported",
  failed: "Failed",
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function labelEntity(type?: string | null): string {
  if (!type) return "Item";
  const key = type.toLowerCase();
  return ENTITY_LABELS[key] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function labelAction(action?: string | null): string {
  if (!action) return "Activity";
  const key = action.toLowerCase();
  return ACTION_LABELS[key] || action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function labelField(key: string): string {
  return FIELD_LABELS[key] || key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    if (Math.abs(v) >= 1000 && Number.isFinite(v)) {
      // Indian grouping for large figures in activity timelines
      return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
    }
    return String(v);
  }
  if (typeof v === "string") {
    // Short ISO date
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    }
    return v.length > 120 ? `${v.slice(0, 117)}…` : v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return "None";
    return v.map(formatValue).join(", ");
  }
  if (isPlainObject(v)) {
    // Prefer known friendly keys
    if (typeof v.title === "string") return v.title;
    if (typeof v.name === "string") return v.name;
    if (typeof v.message === "string") return v.message;
    return Object.entries(v)
      .slice(0, 4)
      .map(([k, val]) => `${labelField(k)}: ${formatValue(val)}`)
      .join(" · ");
  }
  return String(v);
}

/** Parse payload that might already be a JSON string */
export function asRecord(payload: unknown): Record<string, unknown> | null {
  if (payload == null) return null;
  if (typeof payload === "string") {
    const t = payload.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        const parsed = JSON.parse(t) as unknown;
        return isPlainObject(parsed) ? parsed : { value: parsed };
      } catch {
        return { message: payload };
      }
    }
    return { message: payload };
  }
  if (isPlainObject(payload)) return payload;
  if (Array.isArray(payload)) return { items: payload };
  return { value: payload };
}

export type FriendlyActivity = {
  headline: string;
  summary: string;
  bullets: string[];
  /** Raw JSON string — only for debug UI */
  debugJson: string | null;
};

/**
 * Build friendly headline + summary for audit/activity rows.
 */
export function formatActivityEvent(input: {
  action?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  details?: unknown;
  metadata?: unknown;
}): FriendlyActivity {
  const action = labelAction(input.action);
  const entity = labelEntity(input.entityType);
  const payload = asRecord(input.metadata ?? input.details);

  const headline = `${action} ${entity}`.trim();

  const bullets: string[] = [];
  let summary = "";

  if (payload) {
    // Prefer a clear title/name/message first
    if (typeof payload.title === "string" && payload.title) {
      summary = String(payload.title);
    } else if (typeof payload.name === "string" && payload.name) {
      summary = String(payload.name);
    } else if (typeof payload.message === "string" && payload.message) {
      summary = String(payload.message);
    } else if (typeof payload.number === "string" || typeof payload.number === "number") {
      summary = `${entity} #${payload.number}`;
    }

    const skip = new Set(["title", "name", "message"]);
    for (const [key, val] of Object.entries(payload)) {
      if (skip.has(key)) continue;
      if (val == null || val === "") continue;
      // Skip huge nested blobs in bullets
      if (isPlainObject(val) && Object.keys(val).length > 6) continue;
      bullets.push(`${labelField(key)}: ${formatValue(val)}`);
      if (bullets.length >= 5) break;
    }
  }

  if (!summary) {
    if (bullets.length > 0) summary = bullets[0];
    else if (input.entityId) summary = `Record ${String(input.entityId).slice(0, 10)}…`;
    else summary = "No additional details";
  }

  let debugJson: string | null = null;
  if (payload && Object.keys(payload).length > 0) {
    try {
      debugJson = JSON.stringify(payload, null, 2);
    } catch {
      debugJson = String(payload);
    }
  }

  return { headline, summary, bullets, debugJson };
}

/**
 * Notification message may be plain text or accidental JSON — normalize for display.
 */
export function formatNotificationMessage(message: unknown, title?: string): string {
  if (message == null) return title || "Notification";
  if (typeof message === "string") {
    const t = message.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (isPlainObject(parsed)) {
          if (typeof parsed.message === "string") return parsed.message;
          if (typeof parsed.title === "string") return parsed.title;
          return formatValue(parsed);
        }
        return formatValue(parsed);
      } catch {
        return message;
      }
    }
    return message;
  }
  if (isPlainObject(message)) {
    if (typeof message.message === "string") return message.message;
    if (typeof message.title === "string") return message.title;
    return formatValue(message);
  }
  return formatValue(message);
}

export function formatNotificationTitle(title: unknown): string {
  if (title == null) return "Notification";
  if (typeof title === "string") {
    const t = title.trim();
    if (t.startsWith("{") && t.endsWith("}")) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (isPlainObject(parsed) && typeof parsed.title === "string") return parsed.title;
      } catch {
        /* keep raw */
      }
    }
    return title;
  }
  return formatValue(title);
}

/** Dev-only: show raw JSON when NODE_ENV is development and user enables it */
export function isDebugPayloadMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      process.env.NODE_ENV === "development" &&
      localStorage.getItem("massive_mentor_debug_payloads") === "1"
    );
  } catch {
    return false;
  }
}
