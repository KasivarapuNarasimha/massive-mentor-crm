/**
 * PostgreSQL advisory locks for multi-instance scheduled jobs.
 * Session-level locks via pg_try_advisory_lock — safe across API replicas.
 */
import { prisma } from "@/lib/prisma";

/** Stable 64-bit key from a string name (two int4 for pg_try_advisory_lock). */
function lockKeys(name: string): [number, number] {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x811c9dc5) >>> 0;
  }
  // Signed int32 range for Postgres
  const a = h1 > 0x7fffffff ? h1 - 0x100000000 : h1;
  const b = h2 > 0x7fffffff ? h2 - 0x100000000 : h2;
  return [a, b];
}

/**
 * Try to acquire a named lock and run fn. If another instance holds the lock, skip.
 * Always releases the lock afterwards.
 */
export async function withDistributedLock<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ ran: boolean; result?: T }> {
  const [k1, k2] = lockKeys(name);
  const rows = await prisma.$queryRawUnsafe<Array<{ locked: boolean }>>(
    `SELECT pg_try_advisory_lock($1::int, $2::int) AS locked`,
    k1,
    k2
  );
  const locked = !!rows?.[0]?.locked;
  if (!locked) {
    return { ran: false };
  }
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    await prisma
      .$queryRawUnsafe(`SELECT pg_advisory_unlock($1::int, $2::int)`, k1, k2)
      .catch(() => undefined);
  }
}
