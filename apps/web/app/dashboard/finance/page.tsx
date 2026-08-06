"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { emitDataChanged } from "@/lib/data-events";
import { PaginationBar } from "@/components/ui/PaginationBar";
import { toast } from "sonner";
import { ExportFiltersBar } from "@/components/ui/ExportFiltersBar";
import { isCurrencyCode, setAppCurrency, parseAmount } from "@/lib/currency";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { CurrencyAmountInput } from "@/components/ui/CurrencyAmountInput";

type Kpis = {
  totalInvoiced: number;
  totalPaid: number;
  totalExpenses: number;
  totalTax: number;
  outstanding: number;
  profit: number;
  monthRevenue: number;
  yearRevenue: number;
  monthExpenses: number;
  overdueCount: number;
  invoiceCount: number;
  paidInvoiceCount: number;
};

type Invoice = {
  id: string;
  number: string;
  clientName: string | null;
  amount: number;
  taxAmount: number;
  total: number;
  status: string;
  dueDate: string | null;
};

type Expense = {
  id: string;
  title: string;
  category: string;
  total: number;
  expenseDate: string;
  vendor: string | null;
};

type Payment = {
  id: string;
  amount: number;
  method: string;
  paidAt: string;
  invoice?: { number: string; clientName: string | null } | null;
};

const inputClass =
  "w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-border";

export default function FinancePage() {
  const { token } = useAuth();
  const { currency, money, setCurrency } = useBusinessCurrency();
  const [tab, setTab] = useState<"overview" | "invoices" | "expenses" | "payments">("overview");
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [cashFlow, setCashFlow] = useState<Array<{ month: string; inflow: number; outflow: number; net: number }>>([]);
  const [pnl, setPnl] = useState<{ revenue: number; expenses: number; grossProfit: number; taxCollected: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invPage, setInvPage] = useState(1);
  const [invTotal, setInvTotal] = useState(0);
  const [invPages, setInvPages] = useState(1);
  const [expPage, setExpPage] = useState(1);
  const [expTotal, setExpTotal] = useState(0);
  const [expPages, setExpPages] = useState(1);
  const [payPage, setPayPage] = useState(1);
  const [payTotal, setPayTotal] = useState(0);
  const [payPages, setPayPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");

  const [invForm, setInvForm] = useState({
    clientName: "",
    amount: "",
    taxRate: "18",
    dueDate: "",
    description: "",
  });
  const [expForm, setExpForm] = useState({
    title: "",
    amount: "",
    category: "general",
    vendor: "",
  });
  const [payForm, setPayForm] = useState({
    amount: "",
    invoiceId: "",
    method: "upi",
    reference: "",
  });

  const loadDashboard = useCallback(async () => {
    if (!token) return;
    const res = await api.get<{
      currency?: string;
      kpis: Kpis;
      cashFlow: typeof cashFlow;
      profitAndLoss: typeof pnl;
    }>("/finance/dashboard", token);
    if (res.success && res.data) {
      if (res.data.currency && isCurrencyCode(res.data.currency)) {
        setCurrency(res.data.currency);
        setAppCurrency(res.data.currency);
      }
      setKpis(res.data.kpis);
      setCashFlow(res.data.cashFlow || []);
      setPnl(res.data.profitAndLoss || null);
    } else if (res.error) {
      toast.error(res.error);
    }
    setLoading(false);
  }, [token, setCurrency]);

  const loadInvoices = useCallback(async () => {
    if (!token) return;
    const q = new URLSearchParams({
      page: String(invPage),
      pageSize: String(pageSize),
      ...(search ? { search } : {}),
    });
    const res = await api.get<{
      invoices: Invoice[];
      total: number;
      totalPages: number;
    }>(`/finance/invoices?${q}`, token);
    if (res.success && res.data) {
      setInvoices(res.data.invoices || []);
      setInvTotal(res.data.total || 0);
      setInvPages(res.data.totalPages || 1);
    }
  }, [token, invPage, pageSize, search]);

  const loadExpenses = useCallback(async () => {
    if (!token) return;
    const q = new URLSearchParams({
      page: String(expPage),
      pageSize: String(pageSize),
      ...(search ? { search } : {}),
    });
    const res = await api.get<{
      expenses: Expense[];
      total: number;
      totalPages: number;
    }>(`/finance/expenses?${q}`, token);
    if (res.success && res.data) {
      setExpenses(res.data.expenses || []);
      setExpTotal(res.data.total || 0);
      setExpPages(res.data.totalPages || 1);
    }
  }, [token, expPage, pageSize, search]);

  const loadPayments = useCallback(async () => {
    if (!token) return;
    const q = new URLSearchParams({
      page: String(payPage),
      pageSize: String(pageSize),
    });
    const res = await api.get<{
      payments: Payment[];
      total: number;
      totalPages: number;
    }>(`/finance/payments?${q}`, token);
    if (res.success && res.data) {
      setPayments(res.data.payments || []);
      setPayTotal(res.data.total || 0);
      setPayPages(res.data.totalPages || 1);
    }
  }, [token, payPage, pageSize]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (tab === "invoices") loadInvoices();
    if (tab === "expenses") loadExpenses();
    if (tab === "payments") loadPayments();
  }, [tab, loadInvoices, loadExpenses, loadPayments]);

  const createInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const res = await api.post(
      "/finance/invoices",
      {
        clientName: invForm.clientName,
        amount: parseAmount(invForm.amount) ?? 0,
        taxRate: Number(invForm.taxRate || 0),
        dueDate: invForm.dueDate || undefined,
        description: invForm.description,
        status: "sent",
      },
      token
    );
    if (res.success) {
      toast.success("Invoice created");
      setInvForm({ clientName: "", amount: "", taxRate: "18", dueDate: "", description: "" });
      emitDataChanged({ module: "finance", action: "create" });
      loadInvoices();
      loadDashboard();
    } else toast.error(res.error || "Failed");
  };

  const createExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const res = await api.post(
      "/finance/expenses",
      {
        title: expForm.title,
        amount: parseAmount(expForm.amount) ?? 0,
        category: expForm.category,
        vendor: expForm.vendor,
      },
      token
    );
    if (res.success) {
      toast.success("Expense recorded");
      setExpForm({ title: "", amount: "", category: "general", vendor: "" });
      emitDataChanged({ module: "finance", action: "create" });
      loadExpenses();
      loadDashboard();
    } else toast.error(res.error || "Failed");
  };

  const createPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const res = await api.post(
      "/finance/payments",
      {
        amount: parseAmount(payForm.amount) ?? 0,
        invoiceId: payForm.invoiceId || undefined,
        method: payForm.method,
        reference: payForm.reference,
      },
      token
    );
    if (res.success) {
      toast.success("Payment recorded");
      setPayForm({ amount: "", invoiceId: "", method: "upi", reference: "" });
      emitDataChanged({ module: "finance", action: "create" });
      loadPayments();
      loadInvoices();
      loadDashboard();
    } else toast.error(res.error || "Failed");
  };

  const deleteInvoice = async (id: string) => {
    if (!token || !confirm("Delete invoice?")) return;
    const r = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api"}/finance/invoices/${id}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    const json = await r.json();
    if (json.success) {
      toast.success("Deleted");
      emitDataChanged({ module: "finance", action: "delete" });
      loadInvoices();
      loadDashboard();
    } else toast.error(json.error || "Failed");
  };

  if (loading && !kpis) {
    return <div className="h-40 animate-pulse bg-card rounded-2xl" />;
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-5 sm:space-y-6 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold">Finance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invoices, expenses, payments, GST/tax, P&amp;L, and cash flow — amounts in your business currency
          </p>
        </div>
        <span
          className="text-xs font-medium px-3 py-1.5 rounded-full border border-border bg-card text-muted-foreground tabular-nums"
          title="From Business Profile currency setting"
        >
          Currency: {currency}
        </span>
      </div>

      <ExportFiltersBar
        module={tab === "expenses" ? "expenses" : tab === "payments" ? "payments" : "invoices"}
        token={token}
        search={search}
        onSearchChange={setSearch}
      />

      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
        {(["overview", "invoices", "expenses", "payments"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`min-h-11 px-4 py-2.5 rounded-xl text-sm capitalize touch-manipulation ${
              tab === t ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && kpis && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            {[
              ["Revenue (paid)", kpis.totalPaid],
              ["Invoiced", kpis.totalInvoiced],
              ["Expenses", kpis.totalExpenses],
              ["Profit", kpis.profit],
              ["Outstanding", kpis.outstanding],
              ["Tax collected", kpis.totalTax],
              ["Month revenue", kpis.monthRevenue],
              ["Year revenue", kpis.yearRevenue],
            ].map(([label, val]) => (
              <div key={String(label)} className="bg-card border border-border rounded-2xl p-3 sm:p-4 min-w-0">
                <div className="text-[10px] sm:text-xs text-muted-foreground leading-snug">{label}</div>
                <div className="text-lg sm:text-2xl font-semibold tabular-nums mt-1 truncate">
                  {money(Number(val))}
                </div>
              </div>
            ))}
          </div>

          {pnl && (
            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="font-semibold mb-3">Profit &amp; Loss</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>Revenue: <strong>{money(pnl.revenue)}</strong></div>
                <div>Expenses: <strong>{money(pnl.expenses)}</strong></div>
                <div>Gross profit: <strong className={pnl.grossProfit >= 0 ? "text-emerald-400" : "text-red-400"}>{money(pnl.grossProfit)}</strong></div>
                <div>GST/Tax: <strong>{money(pnl.taxCollected)}</strong></div>
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="font-semibold mb-3">Cash flow (12 months)</h3>
            <div className="space-y-2">
              {cashFlow.map((c) => {
                const max = Math.max(...cashFlow.map((x) => Math.max(x.inflow, x.outflow, 1)));
                return (
                  <div key={c.month} className="text-xs">
                    <div className="flex justify-between text-muted-foreground mb-0.5">
                      <span>{c.month}</span>
                      <span className={c.net >= 0 ? "text-emerald-400" : "text-red-400"}>
                        net {money(c.net)}
                      </span>
                    </div>
                    <div className="flex gap-1 h-2">
                      <div
                        className="bg-emerald-500/80 rounded"
                        style={{ width: `${(c.inflow / max) * 100}%` }}
                        title={`In ${money(c.inflow)}`}
                      />
                      <div
                        className="bg-red-500/70 rounded"
                        style={{ width: `${(c.outflow / max) * 100}%` }}
                        title={`Out ${money(c.outflow)}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === "invoices" && (
        <div className="space-y-4">
          <form onSubmit={createInvoice} className="bg-card border border-border rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <h3 className="sm:col-span-2 font-semibold">Create invoice</h3>
            <input className={inputClass} placeholder="Client name" value={invForm.clientName} onChange={(e) => setInvForm({ ...invForm, clientName: e.target.value })} />
            <CurrencyAmountInput
              className={inputClass}
              placeholder="Amount"
              required
              value={invForm.amount}
              currency={currency}
              onValueChange={(raw) => setInvForm({ ...invForm, amount: raw })}
            />
            <input className={inputClass} type="number" step="0.01" placeholder="Tax rate %" value={invForm.taxRate} onChange={(e) => setInvForm({ ...invForm, taxRate: e.target.value })} />
            <input className={inputClass} type="date" value={invForm.dueDate} onChange={(e) => setInvForm({ ...invForm, dueDate: e.target.value })} />
            <input className={inputClass + " sm:col-span-2"} placeholder="Description" value={invForm.description} onChange={(e) => setInvForm({ ...invForm, description: e.target.value })} />
            <button type="submit" className="sm:col-span-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium">Save invoice</button>
          </form>
          <input className={inputClass} placeholder="Search invoices…" value={search} onChange={(e) => { setSearch(e.target.value); setInvPage(1); }} />
          <div className="space-y-2">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex flex-wrap justify-between gap-2 bg-card border border-border rounded-xl p-3 text-sm">
                <div>
                  <div className="font-medium">{inv.number} · {inv.clientName || "—"}</div>
                  <div className="text-xs text-muted-foreground">{inv.status} · tax {money(inv.taxAmount)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{money(inv.total)}</span>
                  <button type="button" className="text-xs text-red-400" onClick={() => deleteInvoice(inv.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
          <PaginationBar page={invPage} pageSize={pageSize} total={invTotal} totalPages={invPages} onPageChange={setInvPage} onPageSizeChange={(s) => { setPageSize(s); setInvPage(1); }} />
        </div>
      )}

      {tab === "expenses" && (
        <div className="space-y-4">
          <form onSubmit={createExpense} className="bg-card border border-border rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <h3 className="sm:col-span-2 font-semibold">Record expense</h3>
            <input className={inputClass} placeholder="Title" required value={expForm.title} onChange={(e) => setExpForm({ ...expForm, title: e.target.value })} />
            <CurrencyAmountInput
              className={inputClass}
              placeholder="Amount"
              required
              value={expForm.amount}
              currency={currency}
              onValueChange={(raw) => setExpForm({ ...expForm, amount: raw })}
            />
            <input className={inputClass} placeholder="Category" value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })} />
            <input className={inputClass} placeholder="Vendor" value={expForm.vendor} onChange={(e) => setExpForm({ ...expForm, vendor: e.target.value })} />
            <button type="submit" className="sm:col-span-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium">Save expense</button>
          </form>
          <div className="space-y-2">
            {expenses.map((ex) => (
              <div key={ex.id} className="flex justify-between bg-card border border-border rounded-xl p-3 text-sm">
                <div>
                  <div className="font-medium">{ex.title}</div>
                  <div className="text-xs text-muted-foreground">{ex.category} · {ex.vendor || "—"}</div>
                </div>
                <span className="font-semibold tabular-nums text-red-300">{money(ex.total)}</span>
              </div>
            ))}
          </div>
          <PaginationBar page={expPage} pageSize={pageSize} total={expTotal} totalPages={expPages} onPageChange={setExpPage} onPageSizeChange={(s) => { setPageSize(s); setExpPage(1); }} />
        </div>
      )}

      {tab === "payments" && (
        <div className="space-y-4">
          <form onSubmit={createPayment} className="bg-card border border-border rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <h3 className="sm:col-span-2 font-semibold">Record payment</h3>
            <CurrencyAmountInput
              className={inputClass}
              placeholder="Amount"
              required
              value={payForm.amount}
              currency={currency}
              onValueChange={(raw) => setPayForm({ ...payForm, amount: raw })}
            />
            <input className={inputClass} placeholder="Invoice ID (optional)" value={payForm.invoiceId} onChange={(e) => setPayForm({ ...payForm, invoiceId: e.target.value })} />
            <select className={inputClass} value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
              <option value="upi">UPI</option>
              <option value="bank">Bank</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
            <input className={inputClass} placeholder="Reference" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
            <button type="submit" className="sm:col-span-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium">Save payment</button>
          </form>
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.id} className="flex justify-between bg-card border border-border rounded-xl p-3 text-sm">
                <div>
                  <div className="font-medium">{p.method} · {p.invoice?.number || "unlinked"}</div>
                  <div className="text-xs text-muted-foreground">{new Date(p.paidAt).toLocaleString()}</div>
                </div>
                <span className="font-semibold tabular-nums text-emerald-400">{money(p.amount)}</span>
              </div>
            ))}
          </div>
          <PaginationBar page={payPage} pageSize={pageSize} total={payTotal} totalPages={payPages} onPageChange={setPayPage} onPageSizeChange={(s) => { setPageSize(s); setPayPage(1); }} />
        </div>
      )}
    </div>
  );
}
