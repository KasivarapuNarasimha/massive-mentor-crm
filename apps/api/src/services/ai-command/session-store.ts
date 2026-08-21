import type { ActionPlan, ChoiceOption, CommandResult } from "./types.js";

export type PendingSession = {
  type: "needs_input" | "needs_choice" | "needs_confirmation" | "resume_plan";
  plan: ActionPlan;
  stepIndex: number;
  missingFields?: string[];
  choices?: ChoiceOption[];
  confirmToken?: string;
  pendingArgs?: Record<string, unknown>;
  lastEntities: Record<string, { type: string; id: string; label: string }>;
  lastResult?: CommandResult;
};

export type CommandSession = {
  userId: string;
  updatedAt: number;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  pending: PendingSession | null;
  bindings: Record<string, { type: string; id: string; label: string }>;
};

const sessions = new Map<string, CommandSession>();
const TTL_MS = 30 * 60 * 1000;

function key(userId: string, sessionId: string) {
  return `${userId}::${sessionId}`;
}

export function getOrCreateSession(userId: string, sessionId: string): CommandSession {
  const k = key(userId, sessionId);
  const existing = sessions.get(k);
  if (existing && Date.now() - existing.updatedAt < TTL_MS) {
    existing.updatedAt = Date.now();
    return existing;
  }
  const fresh: CommandSession = {
    userId,
    updatedAt: Date.now(),
    history: [],
    pending: null,
    bindings: {},
  };
  sessions.set(k, fresh);
  return fresh;
}

export function touchSession(userId: string, sessionId: string, s: CommandSession) {
  s.updatedAt = Date.now();
  sessions.set(key(userId, sessionId), s);
}

export function clearPending(userId: string, sessionId: string) {
  const s = getOrCreateSession(userId, sessionId);
  s.pending = null;
  touchSession(userId, sessionId, s);
}
