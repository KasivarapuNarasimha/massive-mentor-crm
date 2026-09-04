const API = "http://localhost:4000/api";

async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "123456789", forceNewSession: true }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`${email}: ${j.error}`);
  return j.data.token;
}

async function get(path, token) {
  const r = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: r.status, ok: r.ok };
}

const ba = await login("demo@massivementor.in");
const se = await login("exec.local@massivementor.in");
const sm = await login("mgr.local@massivementor.in");
const ceo = await login("ceo.local@massivementor.in");

const checks = [
  ["BA notifications", await get("/automations/notifications", ba)],
  ["SE notifications", await get("/automations/notifications", se)],
  ["SM notifications", await get("/automations/notifications", sm)],
  ["BA team-activity stream", await get("/automations/team-activity/stream", ba)],
  ["CEO team-activity stream", await get("/automations/team-activity/stream", ceo)],
  ["SE team-activity stream (expect 403)", await get("/automations/team-activity/stream", se)],
  ["SM team-activity stream (expect 403)", await get("/automations/team-activity/stream", sm)],
  ["BA auth/me", await get("/auth/me", ba)],
  ["devices register unauthorized", await get("/devices/push-token", "bogus")],
];

let failed = 0;
for (const [name, res] of checks) {
  let ok = res.ok;
  if (name.includes("expect 403")) ok = res.status === 403;
  if (name.includes("unauthorized")) ok = res.status === 401;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} status=${res.status}`);
  if (!ok) failed++;
}
console.log(`\nfailed=${failed}`);
process.exitCode = failed ? 1 : 0;
