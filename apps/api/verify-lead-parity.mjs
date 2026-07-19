async function login(email, password) {
  const r = await fetch("http://127.0.0.1:4000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return r.json();
}

async function main() {
  const cases = [
    { email: "ui_seed_148348558@test.local", password: "SecurePass1!" },
  ];
  for (const c of cases) {
    const auth = await login(c.email, c.password);
    if (!auth.success) {
      console.log("login fail", c.email, auth);
      continue;
    }
    const token = auth.data.token;
    const h = { Authorization: `Bearer ${token}` };
    const contacts = await fetch(
      "http://127.0.0.1:4000/api/crm/contacts?type=lead&page=1&pageSize=200",
      { headers: h }
    ).then((r) => r.json());
    const listTotal = contacts.data?.total;
    const pageLen = contacts.data?.contacts?.length;
    // Try sales_executive and business_admin dashboards
    for (const role of ["sales_executive", "business_admin", "owner", "ceo"]) {
      const dash = await fetch(
        `http://127.0.0.1:4000/api/dashboards/main?role=${role}&preset=all`,
        { headers: h }
      ).then((r) => r.json());
      if (!dash.success) {
        // try sales_executive key
        const dash2 = await fetch(
          `http://127.0.0.1:4000/api/dashboards/sales_executive?role=${role}&preset=all`,
          { headers: h }
        ).then((r) => r.json());
        if (!dash2.success) continue;
        const w = (dash2.data?.widgets || []).find(
          (x) =>
            /lead/i.test(x.title || "") &&
            (x.type === "metric_kpi" || x.type === "metric_count")
        );
        console.log(c.email, role, "key=sales_executive", "listTotal", listTotal, "pageLen", pageLen, "kpi", w?.title, w?.value, "match", w?.value === listTotal);
        continue;
      }
      const widgets = dash.data?.widgets || [];
      const leadKpis = widgets.filter(
        (x) =>
          /lead/i.test(x.title || "") &&
          (x.type === "metric_kpi" || x.type === "metric_count") &&
          x.value != null
      );
      for (const w of leadKpis) {
        console.log(
          c.email,
          "role",
          role,
          "dash",
          dash.data?.dashboard?.key,
          "listTotal",
          listTotal,
          "pageLen",
          pageLen,
          "kpi",
          w.title,
          w.value,
          "MATCH",
          w.value === listTotal
        );
      }
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
