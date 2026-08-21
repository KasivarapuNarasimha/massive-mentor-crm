import { getContacts, getDeals, getTasks } from "../crm.service.js";
import { listInvoices } from "../finance.service.js";
import { listInventory } from "../erp-purchase.service.js";
import type { ActionContext, ExecuteResult } from "./types.js";

export async function buildPriorityFocus(ctx: ActionContext): Promise<ExecuteResult> {
  const now = Date.now();
  const dayMs = 86400000;

  const [tasks, deals, invoices, inventory, leads] = await Promise.all([
    getTasks(ctx.userId, { page: 1, pageSize: 50, sortBy: "dueDate", sortDir: "asc" }).catch(() => ({
      items: [] as any[],
      total: 0,
    })),
    getDeals(ctx.userId, { page: 1, pageSize: 50, sortBy: "updatedAt", sortDir: "asc" }).catch(() => ({
      items: [] as any[],
      total: 0,
    })),
    listInvoices(ctx.userId, { page: 1, pageSize: 50 }).catch(() => ({ items: [] as any[], total: 0 })),
    listInventory(ctx.userId, { lowStockOnly: true }).catch(() => ({ balances: [] as any[] })),
    getContacts(ctx.userId, { type: "lead", page: 1, pageSize: 30 }).catch(() => ({
      items: [] as any[],
      total: 0,
    })),
  ]);

  const priorities: Array<{ title: string; detail: string; href: string; score: number }> = [];

  for (const t of tasks.items) {
    if (t.status === "done") continue;
    const due = t.dueDate ? new Date(t.dueDate).getTime() : null;
    if (due && due < now) {
      priorities.push({
        title: `Overdue task: ${t.title}`,
        detail: `Due ${new Date(t.dueDate).toLocaleString()}`,
        href: "/dashboard/tasks",
        score: 100,
      });
    } else if (due && due < now + dayMs) {
      priorities.push({
        title: `Task due today: ${t.title}`,
        detail: new Date(t.dueDate).toLocaleString(),
        href: "/dashboard/tasks",
        score: 80,
      });
    }
  }

  for (const d of deals.items) {
    const updated = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
    if (updated && now - updated > 7 * dayMs && !["won", "lost"].includes(String(d.stage || ""))) {
      priorities.push({
        title: `Stale deal: ${d.title}`,
        detail: `Stage ${d.stage} · value ${d.value ?? "—"} · inactive 7+ days`,
        href: "/dashboard/deals",
        score: 70,
      });
    }
  }

  for (const inv of invoices.items as any[]) {
    const due = inv.dueDate ? new Date(inv.dueDate).getTime() : 0;
    if (due && due < now && inv.status !== "paid" && inv.status !== "cancelled") {
      priorities.push({
        title: `Collect ${inv.total} — ${inv.number}`,
        detail: `${inv.clientName || "Client"} · overdue`,
        href: "/dashboard/finance",
        score: 90,
      });
    }
  }

  const balances =
    (inventory as any).balances ||
    (inventory as any).items ||
    (Array.isArray(inventory) ? inventory : []);
  for (const b of balances.slice(0, 5)) {
    priorities.push({
      title: `Low stock: ${b.product?.name || b.productId || "Product"}`,
      detail: `On hand ${b.qtyOnHand}`,
      href: "/dashboard/erp/inventory",
      score: 60,
    });
  }

  for (const l of leads.items.slice(0, 5)) {
    if (["new", "contacted"].includes(String(l.status || ""))) {
      priorities.push({
        title: `Follow up lead: ${l.name || l.company}`,
        detail: `Status ${l.status}${l.value != null ? ` · ${l.value}` : ""}`,
        href: "/dashboard/leads",
        score: 50,
      });
    }
  }

  priorities.sort((a, b) => b.score - a.score);
  const top = priorities.slice(0, 6);

  return {
    message:
      top.length === 0
        ? "No urgent items detected — you're clear for now."
        : `${top.length} priority action(s) today`,
    fields: top.map((p) => ({ label: p.title, value: p.detail })),
    actions: [
      { label: "Open Tasks", href: "/dashboard/tasks" },
      { label: "Open Deals", href: "/dashboard/deals" },
      { label: "Open Finance", href: "/dashboard/finance" },
      { label: "Open Inventory", href: "/dashboard/erp/inventory" },
    ],
    data: { priorities: top },
  };
}
