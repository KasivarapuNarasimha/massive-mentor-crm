import { getContacts, getContactById, getDeals, getTasks } from "../crm.service.js";
import { listInvoices } from "../finance.service.js";
import { listAssignableMembers } from "../lead-assignment.service.js";
import { listProducts } from "../erp-catalog.service.js";
import type { ActionContext, ChoiceOption, SoftRef } from "./types.js";

function scoreText(query: string, ...fields: Array<string | null | undefined>): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  let best = 0;
  for (const f of fields) {
    const v = (f || "").trim().toLowerCase();
    if (!v) continue;
    if (v === q) best = Math.max(best, 100);
    else if (v.startsWith(q)) best = Math.max(best, 80);
    else if (v.includes(q)) best = Math.max(best, 60);
    else if (q.includes(v) && v.length >= 3) best = Math.max(best, 50);
  }
  return best;
}

function softQuery(ref: SoftRef): string | null {
  if (ref == null) return null;
  if (typeof ref === "string") return ref.trim() || null;
  if (typeof ref === "object") {
    if ("id" in ref && ref.id) return null; // already id
    if ("from" in ref && ref.from) return null; // binding
    if ("query" in ref && ref.query) return String(ref.query).trim();
  }
  return null;
}

export function resolveBindingId(ctx: ActionContext, ref: SoftRef): string | null {
  if (ref == null) return null;
  if (typeof ref === "string" && /^c[a-z0-9]{20,}$/i.test(ref)) return ref;
  if (typeof ref === "object") {
    if ("id" in ref && typeof ref.id === "string") return ref.id;
    if ("from" in ref && typeof ref.from === "string") {
      return ctx.bindings[ref.from]?.id || null;
    }
  }
  return null;
}

export async function resolveContactRef(
  ctx: ActionContext,
  ref: SoftRef,
  opts?: { type?: "lead" | "client" }
): Promise<
  | { ok: true; id: string; label: string; raw: Record<string, unknown> }
  | { ok: false; status: "needs_choice"; choices: ChoiceOption[]; message: string }
  | { ok: false; status: "not_found"; message: string }
> {
  const bound = resolveBindingId(ctx, ref);
  if (bound) {
    try {
      const c = await getContactById(ctx.userId, bound);
      const label = String((c as { name?: string; company?: string }).name || (c as { company?: string }).company || bound);
      return { ok: true, id: bound, label, raw: c as Record<string, unknown> };
    } catch {
      return { ok: false, status: "not_found", message: "Contact not found in your workspace." };
    }
  }
  const q = softQuery(ref);
  if (!q) return { ok: false, status: "not_found", message: "Please specify which contact/company." };

  const listed = await getContacts(ctx.userId, {
    type: opts?.type,
    search: q,
    page: 1,
    pageSize: 15,
  });
  const scored = listed.items
    .map((c) => {
      const row = c as {
        id: string;
        name?: string;
        company?: string | null;
        phone?: string | null;
        type?: string;
        status?: string;
      };
      const phoneScore =
        row.phone && q.replace(/\D/g, "") && row.phone.replace(/\D/g, "").includes(q.replace(/\D/g, ""))
          ? 95
          : 0;
      const s = Math.max(
        phoneScore,
        scoreText(q, row.company, row.name, row.phone)
      );
      return { row, s };
    })
    .filter((x) => x.s >= 50)
    .sort((a, b) => b.s - a.s);

  if (scored.length === 0) {
    return { ok: false, status: "not_found", message: `No contact/company matching "${q}" in your workspace.` };
  }
  if (scored.length === 1 || scored[0].s >= 90 && scored[0].s - (scored[1]?.s || 0) >= 15) {
    const row = scored[0].row;
    const label = `${row.name || row.company || "Contact"}${row.company && row.name ? ` (${row.company})` : ""}`;
    return { ok: true, id: row.id, label, raw: row as unknown as Record<string, unknown> };
  }
  return {
    ok: false,
    status: "needs_choice",
    message: `I found ${scored.length} matching contacts. Which one?`,
    choices: scored.slice(0, 8).map((x) => ({
      id: x.row.id,
      label: x.row.name || x.row.company || x.row.id,
      sublabel: [x.row.type, x.row.status, x.row.phone, x.row.company].filter(Boolean).join(" · "),
      field: "contact",
    })),
  };
}

export async function resolveMemberRef(
  ctx: ActionContext,
  ref: SoftRef
): Promise<
  | { ok: true; id: string; label: string }
  | { ok: false; status: "needs_choice"; choices: ChoiceOption[]; message: string }
  | { ok: false; status: "not_found"; message: string }
> {
  const bound = resolveBindingId(ctx, ref);
  if (bound) return { ok: true, id: bound, label: ctx.bindings[String(ref)]?.label || bound };
  const q = softQuery(ref);
  if (!q) return { ok: false, status: "not_found", message: "Please specify who to assign." };

  let members: Array<{ id: string; name: string | null; email: string; role?: string | null }> = [];
  try {
    members = await listAssignableMembers(ctx.userId);
  } catch {
    // fallback: self only
    members = [{ id: ctx.userId, name: "Me", email: "", role: ctx.role }];
  }
  const scored = members
    .map((m) => ({
      m,
      s: scoreText(q, m.name, m.email?.split("@")[0], m.email),
    }))
    .filter((x) => x.s >= 50)
    .sort((a, b) => b.s - a.s);

  if (scored.length === 0) {
    return { ok: false, status: "not_found", message: `No team member matching "${q}".` };
  }
  if (scored.length === 1 || scored[0].s - (scored[1]?.s || 0) >= 15) {
    return {
      ok: true,
      id: scored[0].m.id,
      label: scored[0].m.name || scored[0].m.email,
    };
  }
  return {
    ok: false,
    status: "needs_choice",
    message: `I found ${scored.length} matching team members. Which one?`,
    choices: scored.slice(0, 8).map((x) => ({
      id: x.m.id,
      label: x.m.name || x.m.email,
      sublabel: [x.m.role, x.m.email].filter(Boolean).join(" · "),
      field: "assignee",
    })),
  };
}

export async function resolveDealRef(
  ctx: ActionContext,
  ref: SoftRef
): Promise<
  | { ok: true; id: string; label: string; raw: Record<string, unknown> }
  | { ok: false; status: "needs_choice"; choices: ChoiceOption[]; message: string }
  | { ok: false; status: "not_found"; message: string }
> {
  const bound = resolveBindingId(ctx, ref);
  if (bound) {
    const listed = await getDeals(ctx.userId, { search: undefined, page: 1, pageSize: 50 });
    const hit = listed.items.find((d) => (d as { id: string }).id === bound);
    if (!hit) return { ok: false, status: "not_found", message: "Deal not found." };
    return {
      ok: true,
      id: bound,
      label: String((hit as { title?: string }).title || bound),
      raw: hit as Record<string, unknown>,
    };
  }
  const q = softQuery(ref);
  if (!q) return { ok: false, status: "not_found", message: "Please specify which deal." };
  const listed = await getDeals(ctx.userId, { search: q, page: 1, pageSize: 15 });
  const scored = listed.items
    .map((d) => {
      const row = d as { id: string; title?: string; stage?: string; contact?: { name?: string } | null };
      return { row, s: scoreText(q, row.title, row.contact?.name) };
    })
    .filter((x) => x.s >= 50)
    .sort((a, b) => b.s - a.s);
  if (scored.length === 0) {
    return { ok: false, status: "not_found", message: `No deal matching "${q}".` };
  }
  if (scored.length === 1 || scored[0].s - (scored[1]?.s || 0) >= 15) {
    return {
      ok: true,
      id: scored[0].row.id,
      label: scored[0].row.title || scored[0].row.id,
      raw: scored[0].row as unknown as Record<string, unknown>,
    };
  }
  return {
    ok: false,
    status: "needs_choice",
    message: `I found ${scored.length} matching deals. Which one?`,
    choices: scored.slice(0, 8).map((x) => ({
      id: x.row.id,
      label: x.row.title || x.row.id,
      sublabel: [x.row.stage, x.row.contact?.name].filter(Boolean).join(" · "),
      field: "deal",
    })),
  };
}

export async function resolveInvoiceRef(
  ctx: ActionContext,
  ref: SoftRef
): Promise<
  | { ok: true; id: string; label: string; raw: Record<string, unknown> }
  | { ok: false; status: "needs_choice"; choices: ChoiceOption[]; message: string }
  | { ok: false; status: "not_found"; message: string }
> {
  const bound = resolveBindingId(ctx, ref);
  const q = softQuery(ref) || (bound ? undefined : null);
  const listed = await listInvoices(ctx.userId, { search: q || undefined, page: 1, pageSize: 20 });
  const items = (listed as { items?: unknown[] }).items || [];
  const rows = items as Array<{
    id: string;
    number?: string;
    clientName?: string | null;
    total?: number;
    status?: string;
  }>;
  if (bound) {
    const hit = rows.find((r) => r.id === bound);
    if (hit) return { ok: true, id: hit.id, label: hit.number || hit.id, raw: hit as unknown as Record<string, unknown> };
  }
  if (!q) return { ok: false, status: "not_found", message: "Please specify the invoice." };
  const scored = rows
    .map((r) => ({ r, s: scoreText(q, r.number, r.clientName) }))
    .filter((x) => x.s >= 50)
    .sort((a, b) => b.s - a.s);
  if (scored.length === 0) return { ok: false, status: "not_found", message: `No invoice matching "${q}".` };
  if (scored.length === 1 || scored[0].s - (scored[1]?.s || 0) >= 10) {
    return {
      ok: true,
      id: scored[0].r.id,
      label: scored[0].r.number || scored[0].r.id,
      raw: scored[0].r as unknown as Record<string, unknown>,
    };
  }
  return {
    ok: false,
    status: "needs_choice",
    message: `I found ${scored.length} invoices. Which one?`,
    choices: scored.slice(0, 8).map((x) => ({
      id: x.r.id,
      label: x.r.number || x.r.id,
      sublabel: [x.r.clientName, x.r.status, x.r.total != null ? String(x.r.total) : ""].filter(Boolean).join(" · "),
      field: "invoice",
    })),
  };
}

export async function resolveProductRef(
  ctx: ActionContext,
  ref: SoftRef
): Promise<
  | { ok: true; id: string; label: string; raw: Record<string, unknown> }
  | { ok: false; status: "needs_choice"; choices: ChoiceOption[]; message: string }
  | { ok: false; status: "not_found"; message: string }
> {
  const q = softQuery(ref) || resolveBindingId(ctx, ref);
  if (!q) return { ok: false, status: "not_found", message: "Please specify the product." };
  const listed = await listProducts(ctx.userId, { search: softQuery(ref) || undefined });
  const items = (listed as { products?: unknown[] }).products || [];
  const rows = items as Array<{ id: string; name?: string; sku?: string | null }>;
  const bound = resolveBindingId(ctx, ref);
  if (bound) {
    const hit = rows.find((r) => r.id === bound);
    if (hit) return { ok: true, id: hit.id, label: hit.name || hit.sku || hit.id, raw: hit as unknown as Record<string, unknown> };
  }
  const query = softQuery(ref) || "";
  const scored = rows
    .map((r) => ({ r, s: scoreText(query, r.name, r.sku) }))
    .filter((x) => x.s >= 50)
    .sort((a, b) => b.s - a.s);
  if (scored.length === 0) return { ok: false, status: "not_found", message: `No product matching "${query}".` };
  if (scored.length === 1 || scored[0].s - (scored[1]?.s || 0) >= 15) {
    return {
      ok: true,
      id: scored[0].r.id,
      label: scored[0].r.name || scored[0].r.sku || scored[0].r.id,
      raw: scored[0].r as unknown as Record<string, unknown>,
    };
  }
  return {
    ok: false,
    status: "needs_choice",
    message: `I found ${scored.length} products. Which one?`,
    choices: scored.slice(0, 8).map((x) => ({
      id: x.r.id,
      label: x.r.name || x.r.id,
      sublabel: x.r.sku || undefined,
      field: "product",
    })),
  };
}

export { getTasks };
