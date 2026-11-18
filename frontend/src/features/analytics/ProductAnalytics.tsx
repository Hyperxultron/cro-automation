import { useEffect, useMemo, useState } from "react";
import { Info, Package, Search } from "lucide-react";
import { api, formatMoney, type DashboardSummary, type ProductPerformance } from "../../services/api";

const statusStyle: Record<string, string> = {
  top: "bg-emerald-50 text-emerald-700",
  average: "bg-amber-50 text-amber-700",
  low: "bg-red-50 text-red-700",
};
const statusLabel: Record<string, string> = { top: "Top performer", average: "Average", low: "Low performer" };

type SortKey = "revenue" | "quantity" | "name";

function ProductAnalytics() {
  const [products, setProducts] = useState<ProductPerformance[]>([]);
  const [currency, setCurrency] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("revenue");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.summary().catch(() => null as DashboardSummary | null), api.productPerformance(days)])
      .then(([s, p]) => {
        if (s) setCurrency(s.store.currency);
        setProducts(p.products);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load product data"))
      .finally(() => setLoading(false));
  }, [days]);

  const filtered = useMemo(() => {
    let list = products;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.category ?? "").toLowerCase().includes(q));
    }
    const sorted = [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      return (b[sort] as number) - (a[sort] as number);
    });
    return sorted;
  }, [products, search, sort]);

  const lowCount = products.filter((p) => p.performance_status === "low").length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Main / Analytics</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Product Analytics</h1>
        <p className="mt-2 text-sm text-slate-500">Revenue and orders by product, ranked by performance.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Products with sales</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">{loading ? "…" : products.length}</h2>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Low performers</p>
          <h2 className="mt-2 text-2xl font-bold text-red-600">{loading ? "…" : lowCount}</h2>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="mb-2 text-sm text-slate-500">Window</p>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none"
          >
            <option value={1}>Today</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Package className="text-blue-500" size={20} />
            <h3 className="font-bold text-slate-900">Product Performance</h3>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products…"
                className="rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none"
            >
              <option value="revenue">Sort: Revenue</option>
              <option value="quantity">Sort: Quantity</option>
              <option value="name">Sort: Name</option>
            </select>
          </div>
        </div>

        {!loading && filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-400">No products match.</p>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-3 pr-4">Product</th>
                  <th className="pb-3 pr-4">Category</th>
                  <th className="pb-3 pr-4 text-right">Qty Sold</th>
                  <th className="pb-3 pr-4 text-right">Revenue</th>
                  <th className="pb-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.name} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="py-3 pr-4 font-medium text-slate-800">{p.name}</td>
                    <td className="py-3 pr-4 text-slate-500">{p.category ?? "—"}</td>
                    <td className="py-3 pr-4 text-right text-slate-700">{p.quantity}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-slate-900">
                      {formatMoney(p.revenue, currency)}
                    </td>
                    <td className="py-3 text-right">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle[p.performance_status]}`}>
                        {statusLabel[p.performance_status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
        <Info size={15} className="mt-0.5 shrink-0" />
        Product page views and per-product conversion rate aren't shown here - Shopify's Admin API doesn't expose
        per-product view counts via this integration, so we don't fabricate that number.
      </div>
    </div>
  );
}

export default ProductAnalytics;
