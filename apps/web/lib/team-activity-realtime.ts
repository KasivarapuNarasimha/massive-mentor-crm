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

/**
 * Subscribe to GET /api/automations/team-activity/stream (SSE via fetch + Bearer).
 * Mirrors billing-realtime.ts pattern.
 */
export function connectTeamActivityStream(
  token: string,
  onEvent: (payload: TeamActivityStreamEvent) => void,
  opts?: { onStatus?: (status: "connecting" | "open" | "closed" | "error") => void }
): () => void {
  const ac = new AbortController();
  let closed = false;
  let attempt = 0;

  const run = async () => {
    while (!closed && !ac.signal.aborted) {
      opts?.onStatus?.("connecting");
      try {
        const url = `${API_BASE_URL}/automations/team-activity/stream`;
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          signal: ac.signal,
          // Fetch cache mode is enough; do not send Cache-Control (CORS-forbidden).
          cache: "no-store",
        });

        if (!res.ok || !res.body) {
          throw new Error(`stream HTTP ${res.status}`);
        }

        opts?.onStatus?.("open");
        attempt = 0;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Normalize CRLF from some proxies before framing
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
              onEvent(payload);
            } catch {
              /* ignore malformed frame */
            }
          }
        }
      } catch {
        if (ac.signal.aborted || closed) break;
        opts?.onStatus?.("error");
        attempt += 1;
        const delay = Math.min(30_000, 1000 * Math.pow(2, Math.min(attempt, 4)));
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      opts?.onStatus?.("closed");
      await new Promise((r) => setTimeout(r, 2000));
    }
  };

  void run();
  return () => {
    closed = true;
    ac.abort();
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
    // Always attempt resume from the gesture; Chrome may keep context suspended
    // until resume() runs inside that user-activation window.
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

  const unlock = () => {
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
 * Chrome autoplay policy keeps AudioContext suspended until then; our play()
 * also no-ops until unlock so silence is intentional until Enable Sound / click.
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
      // Resume is async; schedule the tone after Chrome allows audio.
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
