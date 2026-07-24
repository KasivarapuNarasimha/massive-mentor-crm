"use client";

import { formatActivityEvent, isDebugPayloadMode } from "@/lib/format-activity";

type Props = {
  action?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  details?: unknown;
  metadata?: unknown;
  actorLabel?: string | null;
  ip?: string | null;
  createdAt?: string | null;
  className?: string;
};

/**
 * User-facing card for audit/activity rows — never primary-renders raw JSON.
 */
export function ActivityEventCard({
  action,
  entityType,
  entityId,
  details,
  metadata,
  actorLabel,
  ip,
  createdAt,
  className = "",
}: Props) {
  const friendly = formatActivityEvent({ action, entityType, entityId, details, metadata });
  const showDebug = isDebugPayloadMode() && !!friendly.debugJson;

  return (
    <div className={`bg-card border border-border rounded-xl p-3.5 text-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-foreground">{friendly.headline}</div>
          <div className="text-muted-foreground text-xs mt-0.5 line-clamp-2">{friendly.summary}</div>
        </div>
        {createdAt && (
          <time className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">
            {new Date(createdAt).toLocaleString()}
          </time>
        )}
      </div>

      {(actorLabel || ip) && (
        <div className="text-[11px] text-muted-foreground mt-1.5">
          {actorLabel || "System"}
          {ip ? ` · IP ${ip}` : ""}
        </div>
      )}

      {friendly.bullets.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {friendly.bullets.map((b) => (
            <li key={b} className="text-[11px] text-muted-foreground flex gap-1.5">
              <span className="text-muted-foreground shrink-0">•</span>
              <span className="min-w-0 break-words">{b}</span>
            </li>
          ))}
        </ul>
      )}

      {entityId && (
        <div className="text-[10px] text-muted-foreground mt-2 font-mono truncate" title={entityId}>
          Ref {entityId.slice(0, 12)}
          {entityId.length > 12 ? "…" : ""}
        </div>
      )}

      {showDebug && (
        <details className="mt-2">
          <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-muted-foreground select-none">
            Developer payload
          </summary>
          <pre className="mt-1 text-[10px] bg-background p-2 rounded overflow-auto max-h-28 text-muted-foreground">
            {friendly.debugJson}
          </pre>
        </details>
      )}
    </div>
  );
}
