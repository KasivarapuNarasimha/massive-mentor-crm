/**
 * Bootstrap Super Admin staff user + Demo product workspace.
 * Safe to run repeatedly (idempotent).
 *
 * Super Admin credentials (env with defaults):
 *   SUPER_ADMIN_EMAIL    default: team@massivementor.in
 *   SUPER_ADMIN_PASSWORD default: Mentor@42
 *
 * Demo credentials (env with defaults):
 *   DEMO_EMAIL    default: demo@massivementor.in
 *   DEMO_PASSWORD default: 123456789
 */
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { ensureDemoWorkspace, DEMO_EMAIL } from "../services/demo.service.js";

export const SUPER_ADMIN_EMAIL = (
  process.env.SUPER_ADMIN_EMAIL || "team@massivementor.in"
)
  .toLowerCase()
  .trim();
export const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || "Mentor@42";

export async function seedPortals() {
  const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);

  // Super Admin (platformRole only — not a customer)
  let admin = await prisma.user.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: SUPER_ADMIN_EMAIL,
        passwordHash,
        name: "Massive Mentor Super Admin",
        role: "super_admin",
        platformRole: "super_admin",
        isDisabled: false,
      },
    });
    console.log(`[portals] Created Super Admin: ${SUPER_ADMIN_EMAIL}`);
  } else {
    // Always keep platform role + password in sync with env
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        passwordHash,
        platformRole: "super_admin",
        role: "super_admin",
        isDisabled: false,
      },
    });
    console.log(`[portals] Synced Super Admin: ${SUPER_ADMIN_EMAIL}`);
  }

  // Demo workspace with sample data + password sync
  const demo = await ensureDemoWorkspace();
  console.log(`[portals] Demo workspace ready: ${demo.business.name} (${demo.business.id}) · ${DEMO_EMAIL}`);

  return {
    adminEmail: SUPER_ADMIN_EMAIL,
    demoEmail: DEMO_EMAIL,
    demoBusinessId: demo.business.id,
  };
}

// CLI: pnpm --filter @massivementor/api exec tsx src/scripts/seed-portals.ts
const isDirect =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].includes("seed-portals") || process.argv[1].endsWith("seed-portals.ts"));
if (isDirect) {
  seedPortals()
    .then((r) => {
      console.log("[portals] seed complete", r);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
