/**
 * Production-safe rate-limit store shared across PM2 / multi-instance processes.
 *
 * Prefer Redis when REDIS_URL is set (ioredis).
 * Otherwise use PostgreSQL (already required) so limits are not per-process memory.
 *
 * Implements express-rate-limit v7 Store interface.
 */
import type {
  Options,
  Store,
  ClientRateLimitInfo,
  IncrementResponse,
} from "express-rate-limit";
import { prisma } from "./prisma.js";

const TABLE = "rate_limit_buckets";

let tableReady: Promise<void> | null = null;

async function ensurePgTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      // Bound DDL so a stuck DB cannot hang the first API request forever
      const ddl = Promise.all([
        prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          key TEXT PRIMARY KEY,
          total_hits INTEGER NOT NULL DEFAULT 0,
          reset_time TIMESTAMPTZ NOT NULL
        )
      `),
        prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS ${TABLE}_reset_idx ON ${TABLE} (reset_time)`
        ),
      ]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          ddl,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("rate_limit_table_init_timeout")),
              5_000
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  await tableReady;
}

/** Periodic cleanup of expired buckets (best-effort). */
let lastCleanup = 0;
async function maybeCleanup(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM ${TABLE} WHERE reset_time < NOW() - INTERVAL '1 hour'`
    );
  } catch {
    /* ignore */
  }
}

/**
 * PostgreSQL store — correct under concurrent increments via upsert + atomic add.
 */
export class PostgresRateLimitStore implements Store {
  prefix: string;
  windowMs = 60_000;

  constructor(prefix = "rl") {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    void ensurePgTable().catch((e) =>
      console.error("[rate-limit-store] ensure table failed:", e)
    );
  }

  private k(key: string): string {
    return `${this.prefix}:${key}`;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    await ensurePgTable();
    const full = this.k(key);
    const rows = await prisma.$queryRawUnsafe<
      Array<{ total_hits: number; reset_time: Date }>
    >(`SELECT total_hits, reset_time FROM ${TABLE} WHERE key = $1`, full);
    const row = rows[0];
    if (!row) return undefined;
    if (row.reset_time.getTime() <= Date.now()) return undefined;
    return {
      totalHits: Number(row.total_hits),
      resetTime: row.reset_time,
    };
  }

  async increment(key: string): Promise<IncrementResponse> {
    await ensurePgTable();
    void maybeCleanup();
    const full = this.k(key);
    const resetAt = new Date(Date.now() + this.windowMs);

    // Atomic: insert or bump within active window; reset window if expired
    const rows = await prisma.$queryRawUnsafe<
      Array<{ total_hits: number; reset_time: Date }>
    >(
      `
      INSERT INTO ${TABLE} (key, total_hits, reset_time)
      VALUES ($1, 1, $2)
      ON CONFLICT (key) DO UPDATE SET
        total_hits = CASE
          WHEN ${TABLE}.reset_time <= NOW() THEN 1
          ELSE ${TABLE}.total_hits + 1
        END,
        reset_time = CASE
          WHEN ${TABLE}.reset_time <= NOW() THEN EXCLUDED.reset_time
          ELSE ${TABLE}.reset_time
        END
      RETURNING total_hits, reset_time
      `,
      full,
      resetAt
    );
    const row = rows[0];
    return {
      totalHits: Number(row?.total_hits ?? 1),
      resetTime: row?.reset_time ?? resetAt,
    };
  }

  async decrement(key: string): Promise<void> {
    await ensurePgTable();
    const full = this.k(key);
    await prisma.$executeRawUnsafe(
      `
      UPDATE ${TABLE}
      SET total_hits = GREATEST(total_hits - 1, 0)
      WHERE key = $1 AND reset_time > NOW()
      `,
      full
    );
  }

  async resetKey(key: string): Promise<void> {
    await ensurePgTable();
    await prisma.$executeRawUnsafe(`DELETE FROM ${TABLE} WHERE key = $1`, this.k(key));
  }
}

/** Optional Redis store when REDIS_URL is configured (dynamic import — no hard dep). */
export async function tryCreateRedisStore(
  prefix: string
): Promise<Store | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  try {
    // Optional peer dependency — only used when present (no hard package.json dep)
    type RedisClient = {
      on: (event: string, cb: (err: Error) => void) => void;
      get: (k: string) => Promise<string | null>;
      pttl: (k: string) => Promise<number>;
      multi: () => {
        incr: (k: string) => unknown;
        pttl: (k: string) => unknown;
        exec: () => Promise<Array<[Error | null, unknown]> | null>;
      };
      pexpire: (k: string, ms: number) => Promise<unknown>;
      decr: (k: string) => Promise<number>;
      set: (...args: unknown[]) => Promise<unknown>;
      del: (k: string) => Promise<unknown>;
      quit: () => Promise<unknown>;
    };
    type RedisCtor = new (
      url: string,
      opts?: Record<string, unknown>
    ) => RedisClient;
    let RedisCtor: RedisCtor | null = null;
    try {
      // @ts-expect-error optional dependency — may be absent
      const redisMod = await import("ioredis");
      RedisCtor = redisMod.default as RedisCtor;
    } catch {
      RedisCtor = null;
    }
    if (!RedisCtor) {
      console.warn(
        "[rate-limit-store] REDIS_URL set but ioredis is not installed; using PostgreSQL store"
      );
      return null;
    }
    const client = new RedisCtor(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    client.on("error", (err: Error) => {
      console.error("[rate-limit-store] redis error:", err.message);
    });

    // Minimal Redis store using INCR + PEXPIRE
    const windowMsRef = { current: 60_000 };
    const store: Store = {
      prefix,
      init(options: Options) {
        windowMsRef.current = options.windowMs;
      },
      async get(key: string) {
        const k = `${prefix}:${key}`;
        const hits = await client.get(k);
        if (hits == null) return undefined;
        const ttl = await client.pttl(k);
        return {
          totalHits: Number(hits),
          resetTime: new Date(Date.now() + Math.max(ttl, 0)),
        };
      },
      async increment(key: string) {
        const k = `${prefix}:${key}`;
        const multi = client.multi();
        multi.incr(k);
        multi.pttl(k);
        const results = await multi.exec();
        const totalHits = Number(results?.[0]?.[1] ?? 1);
        let ttl = Number(results?.[1]?.[1] ?? -1);
        if (ttl < 0) {
          await client.pexpire(k, windowMsRef.current);
          ttl = windowMsRef.current;
        }
        return {
          totalHits,
          resetTime: new Date(Date.now() + Math.max(ttl, 0)),
        };
      },
      async decrement(key: string) {
        const k = `${prefix}:${key}`;
        const n = await client.decr(k);
        if (n < 0) await client.set(k, "0", "PX", windowMsRef.current, "XX");
      },
      async resetKey(key: string) {
        await client.del(`${prefix}:${key}`);
      },
      async shutdown() {
        await client.quit().catch(() => undefined);
      },
    };
    console.info("[rate-limit-store] using Redis store");
    return store;
  } catch (e) {
    console.warn(
      "[rate-limit-store] Redis init failed, falling back to PostgreSQL:",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

let sharedStorePromise: Promise<Store> | null = null;

/**
 * Singleton shared store for all limiters (same backend, different key prefixes via prefix option).
 */
export function getSharedRateLimitStore(prefix: string): Store {
  // Each limiter needs its own prefix — create thin wrappers over one backend
  const backendPromise = (sharedStorePromise ??= (async () => {
    const redis = await tryCreateRedisStore("mmrl");
    if (redis) return redis;
    console.info("[rate-limit-store] using PostgreSQL store (multi-instance safe)");
    return new PostgresRateLimitStore("mmrl");
  })());

  // Wrapper that namespaces keys per limiter prefix
  const wrapper: Store = {
    prefix,
    init(options: Options) {
      void backendPromise.then((s) => s.init?.(options));
    },
    async get(key: string) {
      const s = await backendPromise;
      return s.get?.(`${prefix}:${key}`);
    },
    async increment(key: string) {
      const s = await backendPromise;
      return s.increment(`${prefix}:${key}`);
    },
    async decrement(key: string) {
      const s = await backendPromise;
      return s.decrement(`${prefix}:${key}`);
    },
    async resetKey(key: string) {
      const s = await backendPromise;
      return s.resetKey(`${prefix}:${key}`);
    },
  };
  return wrapper;
}
