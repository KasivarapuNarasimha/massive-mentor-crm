"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  connectTeamActivityStream,
  installTeamActivitySoundGestureUnlock,
  isTeamActivitySoundMuted,
  isTeamActivitySoundUnlocked,
  needsTeamActivitySoundEnable,
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
 *
 * Sound: Chrome autoplay requires a user gesture before Web Audio can play.
 * We unlock on the first pointer/key/touch after mount, and also show a
 * one-time "Enable Sound" control until unlocked (never re-prompts after).
 * Toasts are in-page Sonner UI — they do NOT use browser Notification permission.
 */
export function TeamActivityToaster() {
  const { token, role, user } = useAuth();
  const seenRef = useRef<Set<string>>(new Set());
  const [showEnableSound, setShowEnableSound] = useState(false);

  const roleKey = String(role || user?.role || "").toLowerCase();
  const canListen =
    ADMIN_ROLES.has(roleKey) || roleKey.includes("admin");

  const refreshEnablePrompt = useCallback(() => {
    if (!canListen) {
      setShowEnableSound(false);
      return;
    }
    setShowEnableSound(needsTeamActivitySoundEnable());
  }, [canListen]);

  // Unlock Web Audio on first user gesture as soon as the shell mounts —
  // do not wait for role resolution, or early clicks during load are lost.
  useEffect(() => {
    return installTeamActivitySoundGestureUnlock(() => {
      setShowEnableSound(false);
    });
  }, []);

  useEffect(() => {
    refreshEnablePrompt();
  }, [refreshEnablePrompt]);

  // If still locked after mount (no gesture yet), show Enable Sound for admins.
  useEffect(() => {
    if (!canListen) return;
    if (needsTeamActivitySoundEnable()) {
      setShowEnableSound(true);
    }
  }, [canListen]);

  useEffect(() => {
    if (!token || !canListen) return;

    const onEvent = (payload: TeamActivityStreamEvent) => {
      const id =
        payload.eventId ||
        `${payload.at}-${payload.actorUserId}-${payload.action}-${payload.entityId}`;
      if (seenRef.current.has(id)) return;
      seenRef.current.add(id);
      if (seenRef.current.size > 200) {
        const first = seenRef.current.values().next().value;
        if (first) seenRef.current.delete(first);
      }

      const title = payload.title || "New Team Activity";
      const message = payload.message || "A team member performed a CRM action";

      // If sound is still locked, surface the enable control (one-time UX).
      if (needsTeamActivitySoundEnable()) {
        setShowEnableSound(true);
      }

      // Render toast first (do not depend on audio). Use top-center to match
      // ThemeAwareToaster — bottom-right was easy to miss behind CRM chrome.
      // Independent of browser Notification permission.
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
              <div className="mt-1 text-[10px] text-muted-foreground">Just now</div>
              <button
                type="button"
                className="mt-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setTeamActivitySoundMuted(!isTeamActivitySoundMuted());
                  refreshEnablePrompt();
                }}
              >
                {isTeamActivitySoundMuted() ? "Unmute sound" : "Mute sound"}
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
        { duration: 8000, position: "top-center", id }
      );

      playTeamActivitySound();
    };

    const disconnect = connectTeamActivityStream(token, onEvent);
    return () => disconnect();
  }, [token, canListen, refreshEnablePrompt]);

  const onEnableSound = () => {
    // Direct user gesture → unlock AudioContext for this origin.
    // Do not clear an intentional mute unless the user explicitly enables sound.
    unlockTeamActivitySound();
    if (isTeamActivitySoundMuted()) {
      setTeamActivitySoundMuted(false);
    }
    setShowEnableSound(false);
    // Confirmation tone so the user hears that sound works now.
    playTeamActivitySound();
  };

  return (
    <>
      {canListen && showEnableSound && !isTeamActivitySoundUnlocked() ? (
        <div
          className="fixed left-1/2 z-[70] -translate-x-1/2 w-[min(28rem,calc(100vw-1.5rem))]"
          style={{ top: "calc(var(--mm-chrome-h, 3.5rem) + 0.5rem)" }}
          role="status"
        >
          <div className="rounded-md border border-border bg-card shadow-md px-3 py-2.5 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground">
                Enable Team Activity sound
              </div>
              <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                Your browser blocks CRM alert tones until you allow sound once.
                Pop-up toasts still work without this.
              </div>
            </div>
            <button
              type="button"
              onClick={onEnableSound}
              className="shrink-0 rounded-md bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 hover:opacity-90"
            >
              Enable Sound
            </button>
            <button
              type="button"
              aria-label="Dismiss sound prompt"
              className="shrink-0 text-muted-foreground hover:text-foreground text-sm px-1"
              onClick={() => {
                // Dismiss only for this page view; next visit still prompts until unlocked.
                setShowEnableSound(false);
              }}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
