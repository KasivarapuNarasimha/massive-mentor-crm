import { z } from "zod";

export class ChatError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export const chatId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const directInput = z.object({ userId: chatId }).strict();
export const groupInput = z.object({
  name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).optional(),
  userIds: z.array(chatId).min(1).max(49),
}).strict();
export const membersInput = z.object({ userIds: z.array(chatId).min(1).max(49) }).strict();
export const messageInput = z.object({
  content: z.string().trim().min(1).max(4000).refine(s => !s.includes("\0")),
  clientMessageId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
}).strict();
export const readInput = z.object({ sequence: z.number().int().min(0).max(2147483646) }).strict();
export const pageInput = z.object({ before: z.coerce.number().int().min(1).max(2147483647).optional() }).strict();
export function directPair(a: string, b: string): string {
  if (a === b || !chatId.safeParse(a).success || !chatId.safeParse(b).success) throw new ChatError(400, "CHAT_INVALID_PEER");
  return [a, b].sort().join(":");
}
export function canManageChat(role: string): boolean {
  return ["owner", "ceo", "admin", "business_admin", "manager", "sales_manager"].includes(role);
}
/** An explicit empty customized grant must never fall back to a legacy template. */
export function chatModuleAllowed(keys: string[], raw: unknown): boolean {
  if(!keys.includes("team_chat"))return false;
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return true;
  const permissions=raw as {customized?:unknown;modules?:unknown};
  return permissions.customized!==true || Array.isArray(permissions.modules)&&permissions.modules.includes("team_chat");
}
export function chatReplay<T extends { conversationId: string; content: string }>(
  existing: T | undefined, conversationId: string, content: string
): T | undefined {
  if (existing && (existing.conversationId !== conversationId || existing.content !== content)) throw new ChatError(409, "CHAT_REPLAY_CONFLICT");
  return existing;
}
