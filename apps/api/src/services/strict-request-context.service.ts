import { AsyncLocalStorage } from "node:async_hooks";
import type { LeadWriteContext } from "./tenant-scope.service.js";

const contexts = new AsyncLocalStorage<Readonly<LeadWriteContext>>();

/** Only the server's validated middleware context is bound, never client input. */
export function runWithStrictBusinessContext<T>(context: Readonly<LeadWriteContext>, callback: () => T): T {
  return contexts.run(Object.freeze({ ...context }), callback);
}

export function getStrictRequestContext(userId: string): Readonly<LeadWriteContext> | undefined {
  const context = contexts.getStore();
  if (context && context.userId !== userId) throw new Error("Strict workspace actor mismatch");
  return context;
}
