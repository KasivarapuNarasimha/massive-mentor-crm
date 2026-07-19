const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const events = await p.locationEvent.findMany({ orderBy: { recordedAt: "desc" }, take: 5 });
  console.log("recent events", events.map(e => ({ type: e.eventType, userId: e.userId, source: e.source, lat: e.latitude, locality: e.locality, city: e.city })));
  const sessions = await p.fieldWorkSession.findMany({ orderBy: { startedAt: "desc" }, take: 5 });
  console.log("sessions", sessions.map(s => ({ id: s.id, status: s.status, userId: s.userId })));
  const states = await p.userLocationState.findMany({ take: 5 });
  console.log("live states", states.map(s => ({ userId: s.userId, status: s.status, locality: s.lastLocality })));
  // sample business config portals for field_sales menu
  const cfg = await p.businessConfig.findFirst({ orderBy: { updatedAt: "desc" } });
  const portals = cfg?.portals || [];
  for (const portal of portals) {
    const has = (portal.menus || []).some(m => (m.route || "").includes("field-sales") || m.key === "field_sales");
    console.log("portal", portal.key, "hasFieldSales", has, "menuCount", (portal.menus||[]).length);
  }
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
