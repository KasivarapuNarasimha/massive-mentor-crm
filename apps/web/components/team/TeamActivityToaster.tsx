"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  connectTeamActivityStream,
  isTeamActivitySoundMuted,
  playTeamActivitySound,
  setTeamActivitySoundMuted,
  unlockTeamActivitySound,
  type TeamActivityStreamEvent,
} from "@/lib/team-activity-realtime";

const ADMIN_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "super_admin",
  "sales_manager",
  "manager",
]);

/**
 * Cross-CRM live team activity toasts (Admin). Mounted in DashboardShell so it
 * works on every CRM route, not only /dashboard.
 */
export function TeamActivityToaster() {
  const { token, role, user } = useAuth();
  const [muted, setMuted] = useState(true);
  const seenRef = useRef<Set<string>>(new Set());

  const roleKey = String(role || user?.role || "").toLowerCase();
  const canListen =
    ADMIN_ROLES.has(roleKey) || roleKey.includes("admin");

  useEffect(() => {
    setMuted(isTeamActivitySoundMuted());
  }, []);

  // Unlock sound after first user gesture (browser autoplay policy)
  useEffect(() => {
    const unlock = () => unlockTeamActivitySound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!token || !canListen) return;

    const onEvent = (payload: TeamActivityStreamEvent) => {
      const id = payload.eventId || `${payload.at}-${payload.actorUserId}-${payload.action}`;
      if (seenRef.current.has(id)) return;
      seenRef.current.add(id);
      // Cap memory
      if (seenRef.current.size > 200) {
        const first = seenRef.current.values().next().value;
        if (first) seenRef.current.delete(first);
      }

      const title = payload.title || "New Team Activity";
      const message = payload.message || "A team member performed a CRM action";

      playTeamActivitySound();

      toast.custom(
        (t) => (
          <div
            className="w-[min(22rem,calc(100vw-1.5rem))] rounded-md border border-border bg-card shadow-sm p-3 flex gap-2.5"
            role="status"
          >
            <div
              className="mt-0.5 h-8 w-8 shrink-0 rounded-md border border-border bg-muted flex items-center justify-center"
              aria-hidden
            >
              <svg className="w-4 h-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z"
                />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground tracking-tight">{title}</div>
              <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug break-words">
                {message}
              </div>
              <button
                type="button"
                className="mt-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                onClick={() => {
                  const next = !isTeamActivitySoundMuted();
                  setTeamActivitySoundMuted(next);
                  setMuted(next);
                }}
              >
                {muted ? "Unmute sound" : "Mute sound"}
              </button>
            </div>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-sm leading-none px-1"
              aria-label="Dismiss"
              onClick={() => toast.dismiss(t)}
            >
              ×
            </button>
          </div>
        ),
        { duration: 5500, position: "bottom-right", id }
      );
    };

    const disconnect = connectTeamActivityStream(token, onEvent);
    return () => disconnect();
  }, [token, canListen, muted]);

  return null;
}
