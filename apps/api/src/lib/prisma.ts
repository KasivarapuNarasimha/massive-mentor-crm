import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Query logging is extremely expensive under load — only enable when DEBUG_PRISMA=1
const logLevel =
  process.env.DEBUG_PRISMA === "1"
    ? (["query", "error", "warn"] as const)
    : env.NODE_ENV === "production"
      ? (["error"] as const)
      : (["error", "warn"] as const);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [...logLevel],
  });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
