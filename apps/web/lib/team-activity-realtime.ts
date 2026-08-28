"use client";

import { API_BASE_URL } from "@/lib/api";

export type TeamActivityStreamEvent = {
  type?: string;
  businessId?: string;
  at?: string;
  eventId?: string;
  actorUserId?: string;
  actorName?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  title?: string;
  message?: string;
};

type StatusFn = (status: "connecting" | "open" | "closed" | "error") => void;

type SharedTeamStream = {
  token: string;
  listeners: Set<(payload: TeamActivityStreamEvent) => void>;
  statusListeners: Set<StatusFn>;
  stop: () => void;
};

let sharedTeamStream: SharedTeamStream | null = null;

function startSharedTeamStream(token: string): SharedTeamStream {
  const ac = new AbortController();
  let closed = false;
  let attempt = 0;
  const listeners = new Set<(payload: TeamActivityStreamEvent) => void>();
  const statusListeners = new Set<StatusFn>();

  const emitStatus = (s: "connecting" | "open" | "closed" | "error") => {
    statusListeners.forEach((fn) => {
      try {
        fn(s);
      } catch {
        /* ignore */
      }
    });
  };

  const run = async () => {
    while (!closed && !ac.signal.aborted) {
      emitStatus("connecting");
      let httpStatus = 0;
      try {
        const url = `${API_BASE_URL}/automations/team-activity/stream`;
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          signal: ac.signal,
          cache: "no-store",
        });
        httpStatus = res.status;

        if (!res.ok || !res.body) {
          throw new Error(`stream HTTP ${res.status}`);
        }

        emitStatus("open");
        attempt = 0;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const frame of parts) {
            const lines = frame.split("\n");
            let eventName = "message";
            const dataLines: string[] = [];
            for (const raw of lines) {
              const line = raw.trimEnd();
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
            }
            if (!dataLines.length) continue;
            if (eventName !== "team_activity") continue;
            try {
              const payload = JSON.parse(dataLines.join("\n")) as TeamActivityStreamEvent;
              listeners.forEach((fn) => {
                try {
                  fn(payload);
                } catch {
                  /* ignore */
                }
              });
            } catch {
              /* ignore malformed frame */
            }
          }
        }
      } catch {
        if (ac.signal.aborted || closed) break;
        emitStatus("error");
        attempt += 1;
        // Back off harder on rate-limit so reconnects do not deepen the 429 window.
        const base = httpStatus === 429 ? 8_000 : 1_000;
        const delay = Math.min(60_000, base * Math.pow(2, Math.min(attempt, 4)));
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      emitStatus("closed");
      // Clean close: brief pause (avoid tight reconnect loops)
      await new Promise((r) => setTimeout(r, 3_000));
    }
  };

  void run();

  return {
    token,
    listeners,
    statusListeners,
    stop: () => {
      closed = true;
      ac.abort();
    },
  };
}

/**
 * Subscribe to GET /api/automations/team-activity/stream (SSE via fetch + Bearer).
 * Multiple subscribers share one connection per token.
 */
export function connectTeamActivityStream(
  token: string,
  onEvent: (payload: TeamActivityStreamEvent) => void,
  opts?: { onStatus?: StatusFn }
): () => void {
  if (!sharedTeamStream || sharedTeamStream.token !== token) {
    sharedTeamStream?.stop();
    sharedTeamStream = startSharedTeamStream(token);
  }

  const shared = sharedTeamStream;
  shared.listeners.add(onEvent);
  if (opts?.onStatus) shared.statusListeners.add(opts.onStatus);

  return () => {
    shared.listeners.delete(onEvent);
    if (opts?.onStatus) shared.statusListeners.delete(opts.onStatus);
    if (shared.listeners.size === 0 && sharedTeamStream === shared) {
      shared.stop();
      sharedTeamStream = null;
    }
  };
}

const SOUND_MUTE_KEY = "mm_team_activity_sound_muted";
const SOUND_UNLOCK_KEY = "mm_team_activity_sound_unlocked";

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

export function isTeamActivitySoundMuted(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(SOUND_MUTE_KEY) === "1";
}

export function setTeamActivitySoundMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SOUND_MUTE_KEY, muted ? "1" : "0");
}

/** Call from a user gesture so later team-activity tones may play. */
export function unlockTeamActivitySound(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SOUND_UNLOCK_KEY, "1");
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Install one-shot document-level gesture listeners that unlock Web Audio.
 * Safe to call multiple times; only the first successful gesture persists unlock.
 * Uses capture phase so clicks during late React mount still count.
 */
export function installTeamActivitySoundGestureUnlock(
  onUnlocked?: () => void
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }
  if (isTeamActivitySoundUnlocked()) {
    onUnlocked?.();
    return () => undefined;
  }

  const unlock = (event: Event) => {
    // Let the Enable Sound button own its click (unlock + confirmation tone).
    const target = event.target as Element | null;
    if (target?.closest?.("[data-mm-enable-sound]")) return;

    unlockTeamActivitySound();
    onUnlocked?.();
    remove();
  };

  const opts: AddEventListenerOptions = { capture: true };
  const remove = () => {
    document.removeEventListener("pointerdown", unlock, opts);
    document.removeEventListener("keydown", unlock, opts);
    document.removeEventListener("touchstart", unlock, opts);
  };

  document.addEventListener("pointerdown", unlock, opts);
  document.addEventListener("keydown", unlock, opts);
  document.addEventListener("touchstart", unlock, opts);
  return remove;
}

export function isTeamActivitySoundUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SOUND_UNLOCK_KEY) === "1";
}

/**
 * True when the CRM has not yet received a user gesture to unlock Web Audio.
 */
export function needsTeamActivitySoundEnable(): boolean {
  if (typeof window === "undefined") return false;
  if (isTeamActivitySoundMuted()) return false;
  return !isTeamActivitySoundUnlocked();
}

function startTeamActivityTone(ctx: AudioContext): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}

/** Short soft notification tone (Web Audio) — once per event, no loop, no external asset. */
export function playTeamActivitySound(): void {
  if (typeof window === "undefined") return;
  if (isTeamActivitySoundMuted()) return;
  if (!isTeamActivitySoundUnlocked()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx
        .resume()
        .then(() => {
          if (ctx.state === "running" && !isTeamActivitySoundMuted()) {
            startTeamActivityTone(ctx);
          }
        })
        .catch(() => undefined);
      return;
    }
    startTeamActivityTone(ctx);
  } catch {
    /* autoplay / unsupported */
  }
}
