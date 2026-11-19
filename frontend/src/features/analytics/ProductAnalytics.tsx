import { useEffect, useMemo, useState } from "react";
import { Info, Package, Search } from "lucide-react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { api, formatMoney, type DashboardSummary, type ProductAnalyticsData, type ProductGroup, type ProductRow } from "../../services/api";
import InfoTip from "../../components/InfoTip";
import { HELP } from "../../components/helpText";

// Product and category analytics (manager checklist, section 4).

const GROUPS: Record<ProductGroup, { label: string; action: string; badge: string; color: string }> = {
  star: { label: "Star", action: "Keep in stock, use in ads", badge: "bg-emerald-50 text-emerald-700", color: "#10b981" },
  hidden_gem: { label: "Hidden gem", action: "Send more traffic: homepage, top row, ads, email", badge: "bg-blue-50 text-blue-700", color: "#3b82f6" },
  leaky: { label: "Leaky", action: "Fix the product page first", badge: "bg-amber-50 text-amber-700", color: "#f59e0b" },
  dead_weight: { label: "Dead weight", action: "Rework or drop", badge: "bg-slate-100 text-slate-600", color: "#94a3b8" },
};

type SortKey = "revenue" | "orders" | "views" | "adjusted_rate" | "revenue_left_on_table" | "name";

const pctText = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);
const changeText = (v: number | null | undefined) =>
  v == null ? <span className="text-slate-400">—</span> : (
    <span className={v === 0 ? "text-slate-500" : v > 0 ? "text-emerald-600" : "text-red-600"}>
      {v > 0 ? "+" : ""}{v}%
    </span>
  );

function ProductAnalytics() {
  const [data, setData] = useState<ProductAnalyticsData | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("revenue");
  const [groupFilter, setGroupFilter] = useState<ProductGroup | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.summary().catch(() => null as DashboardSummary | null), api.productAnalytics(28)])
      .then(([s, d]) => {
        if (s) setCurrency(s.store.currency);
        setData(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load product data"))
      .finally(() => setLoading(false));
  }, []);

  const viewsOn = !!data?.views_available;

  const filtered = useMemo(() => {
    let list: ProductRow[] = data?.products ?? [];
    if (groupFilter !== "all") list = list.filter((p) => p.group === groupFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      return ((b[sort] as number | null | undefined) ?? -Infinity) - ((a[sort] as number | null | undefined) ?? -Infinity);
    });
  }, [data, search, sort, groupFilter]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of data?.products ?? []) if (p.group) counts[p.group] = (counts[p.group] ?? 0) + 1;
    return counts;
  }, [data]);

  const scatterByGroup = useMemo(() => {
    const out: Record<string, { x: number; y: number; z: number; name: string }[]> = {};
    for (const p of data?.products ?? []) {
      if (!p.group || p.views == null || p.add_to_cart_rate == null) continue;
      (out[p.group] ??= []).push({ x: p.views, y: p.add_to_cart_rate, z: Math.max(p.revenue, 1), name: p.name });
    }
    return out;
  }, [data]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Main / Analytics</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Product Analytics</h1>
        <p className="mt-2 text-sm text-slate-500">
          {data?.window_label ?? "Last 28 complete days"}<InfoTip text={HELP.productWindow} />
          {data && <span className="text-slate-400"> · compared with {data.prior_window_label}</span>}
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {data?.views_note && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <Info size={15} className="mt-0.5 shrink-0" />
          {data.views_note}
        </div>
      )}

      {/* Four groups (checklist P1) */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <h3 className="mb-4 font-bold text-slate-900">Product groups<InfoTip text={HELP.productGroups} /></h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(GROUPS) as ProductGroup[]).map((g) => (
            <button
              key={g}
              disabled={!viewsOn}
              onClick={() => setGroupFilter(groupFilter === g ? "all" : g)}
              className={`rounded-xl border p-4 text-left transition ${groupFilter === g ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200"} ${viewsOn ? "hover:border-blue-200" : "cursor-default opacity-70"}`}
            >
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${GROUPS[g].badge}`}>{GROUPS[g].label}</span>
              <p className="mt-3 text-2xl font-bold text-slate-900">{viewsOn ? groupCounts[g] ?? 0 : "—"}</p>
              <p className="mt-1 text-xs text-slate-500">{GROUPS[g].action}</p>
            </button>
          ))}
        </div>
        {viewsOn && Object.keys(scatterByGroup).length > 0 && (
          <div className="mt-6 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" />
                <XAxis type="number" dataKey="x" name="Views" tick={{ fill: "#94a3b8", fontSize: 11 }} label={{ value: "Product views", position: "insideBottom", offset: -5, fill: "#94a3b8", fontSize: 11 }} />
                <YAxis type="number" dataKey="y" name="Add-to-cart rate" unit="%" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <ZAxis type="number" dataKey="z" range={[30, 300]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ payload }) => {
                    const d = payload?.[0]?.payload as { name: string; x: number; y: number } | undefined;
                    return d ? (
                      <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs shadow">
                        <p className="font-semibold">{d.name}</p>
                        <p>{d.x.toLocaleString()} views · {d.y}% add to cart</p>
                      </div>
                    ) : null;
                  }}
                />
                {Object.entries(scatterByGroup).map(([g, pts]) => (
                  <Scatter key={g} name={GROUPS[g as ProductGroup].label} data={pts} fill={GROUPS[g as ProductGroup].color} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Fix-first list (checklist P1) */}
      {viewsOn && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <h3 className="mb-4 font-bold text-slate-900">Fix first: leaky products<InfoTip text={HELP.fixFirst} /></h3>
          {data!.fix_first.length === 0 ? (
            <p className="text-xs text-slate-400">No leaky products right now.</p>
          ) : (
            <ol className="space-y-2">
              {data!.fix_first.map((p, i) => (
                <li key={p.product_id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-50 text-xs font-bold text-amber-700">{i + 1}</span>
                    <span className="truncate font-medium text-slate-800">{p.name}</span>
                    <span className="hidden text-xs text-slate-400 sm:inline">
                      {p.views?.toLocaleString()} views · converts {p.view_to_purchase_rate}% vs {p.category_rate}% for {p.category}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold text-red-600">{formatMoney(p.revenue_left_on_table ?? 0, currency)} left on table</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {/* Category roll-up */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <h3 className="mb-4 font-bold text-slate-900">By category<InfoTip text={HELP.categories} /></h3>
        {loading ? (
          <p className="text-xs text-slate-400">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-400">
                  <th className="py-2 pr-4 font-medium">Category</th>
                  <th className="py-2 pr-4 text-right font-medium">Products sold</th>
                  <th className="py-2 pr-4 text-right font-medium">Orders</th>
                  <th className="py-2 pr-4 text-right font-medium">Revenue</th>
                  <th className="py-2 text-right font-medium">vs prior 28 days</th>
                </tr>
              </thead>
              <tbody>
                {(data?.categories ?? []).map((c) => (
                  <tr key={c.category} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-slate-800">{c.category}</td>
                    <td className="py-2.5 pr-4 text-right text-slate-600">{c.products}</td>
                    <td className="py-2.5 pr-4 text-right text-slate-600">{c.orders}</td>
                    <td className="py-2.5 pr-4 text-right font-semibold text-slate-900">{formatMoney(c.revenue, currency)}</td>
                    <td className="py-2.5 text-right">{changeText(c.revenue_change_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Product table (checklist P1) */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Package className="text-blue-500" size={20} />
            <h3 className="font-bold text-slate-900">All products<InfoTip text={HELP.productTable} /></h3>
            {groupFilter !== "all" && (
              <button onClick={() => setGroupFilter("all")} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                {GROUPS[groupFilter].label} only ✕
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products…"
                className="rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none">
              <option value="revenue">Sort: Revenue</option>
              <option value="orders">Sort: Orders</option>
              {viewsOn && <option value="views">Sort: Views</option>}
              {viewsOn && <option value="adjusted_rate">Sort: Conversion (adjusted)</option>}
              {viewsOn && <option value="revenue_left_on_table">Sort: Revenue left on table</option>}
              <option value="name">Sort: Name</option>
            </select>
          </div>
        </div>

        {loading && <p className="text-xs text-slate-400">Loading…</p>}
        {!loading && filtered.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No products match.</p>}

        {filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-400">
                  <th className="pb-3 pr-4 font-medium">Product</th>
                  <th className="pb-3 pr-4 font-medium">Category</th>
                  {viewsOn && (
                    <>
                      <th className="pb-3 pr-4 text-right font-medium">Views</th>
                      <th className="pb-3 pr-4 text-right font-medium">Add-to-cart rate</th>
                      <th className="pb-3 pr-4 text-right font-medium">Cart → purchase</th>
                      <th className="pb-3 pr-4 text-right font-medium">View → purchase</th>
                      <th className="pb-3 pr-4 text-right font-medium">vs category</th>
                      <th className="pb-3 pr-4 text-right font-medium">Revenue / view</th>
                    </>
                  )}
                  <th className="pb-3 pr-4 text-right font-medium">Orders</th>
                  <th className="pb-3 pr-4 text-right font-medium">Revenue</th>
                  <th className="pb-3 pr-4 text-right font-medium">vs prior 28 days</th>
                  {viewsOn && <th className="pb-3 text-right font-medium">Group</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.product_id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="py-3 pr-4 font-medium text-slate-800">{p.name}</td>
                    <td className="py-3 pr-4 text-slate-500">{p.category}</td>
                    {viewsOn && (
                      <>
                        <td className="py-3 pr-4 text-right text-slate-700">{p.views?.toLocaleString() ?? "—"}</td>
                        <td className="py-3 pr-4 text-right text-slate-700">{pctText(p.add_to_cart_rate)}</td>
                        <td className="py-3 pr-4 text-right text-slate-700">{pctText(p.cart_to_purchase_rate)}</td>
                        <td className="py-3 pr-4 text-right text-slate-700">{pctText(p.view_to_purchase_rate)}</td>
                        <td className={`py-3 pr-4 text-right ${(p.vs_category_pts ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {p.vs_category_pts == null ? "—" : `${p.vs_category_pts > 0 ? "+" : ""}${p.vs_category_pts} pts`}
                        </td>
                        <td className="py-3 pr-4 text-right text-slate-700">
                          {p.revenue_per_view == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(p.revenue_per_view)}
                        </td>
                      </>
                    )}
                    <td className="py-3 pr-4 text-right text-slate-700">{p.orders}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-slate-900">{formatMoney(p.revenue, currency)}</td>
                    <td className="py-3 pr-4 text-right">{changeText(p.revenue_change_pct)}</td>
                    {viewsOn && (
                      <td className="py-3 text-right">
                        {p.group && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${GROUPS[p.group].badge}`}>{GROUPS[p.group].label}</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default ProductAnalytics;
